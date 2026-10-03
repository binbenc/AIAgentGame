import {
  AbortError,
  LLMError,
  type ChatOptions,
  type ChatRequest,
  type ChatResponse,
  type ContentBlock,
  type Provider,
  type StopReason,
  type StreamEvent,
} from '../types'
import { resolveModel, viaProxy, type ProviderConfig, type WireListener } from './config'

/* OpenAI Chat Completions 协议的最小类型 */
interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export function toOpenAIBody(req: ChatRequest, model: string): Record<string, unknown> {
  const messages: OAIMessage[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content } as OAIMessage)
      continue
    }
    if (m.role === 'user') {
      // tool_result 在 OpenAI 协议里是独立的 role: "tool" 消息
      for (const b of m.content)
        if (b.type === 'tool_result')
          messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${b.content}` : b.content })
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n')
      if (text) messages.push({ role: 'user', content: text })
    } else {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      const calls = m.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          const t = b as { id: string; name: string; input: unknown }
          return {
            id: t.id,
            type: 'function' as const,
            function: { name: t.name, arguments: typeof t.input === 'string' ? t.input : JSON.stringify(t.input) },
          }
        })
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    }
  }
  return {
    model,
    messages,
    ...(req.max_tokens ? { max_tokens: req.max_tokens } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
        }
      : {}),
  }
}

function mapFinish(r: string | null | undefined): StopReason {
  if (r === 'stop') return 'end_turn'
  if (r === 'tool_calls' || r === 'function_call') return 'tool_use'
  if (r === 'length') return 'max_tokens'
  if (r === 'content_filter') return 'refusal'
  return 'other'
}

function parseArgs(s: string): unknown {
  try {
    return s ? JSON.parse(s) : {}
  } catch {
    // 模型偶尔会给出非法 JSON：原样保留字符串，让上层的参数校验去处理
    return s
  }
}

interface OAIChoiceMessage {
  content?: string | null
  tool_calls?: OAIToolCall[]
}

export function fromOpenAIResponse(json: {
  model?: string
  choices: { message: OAIChoiceMessage; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}): ChatResponse {
  const choice = json.choices?.[0]
  const content: ContentBlock[] = []
  if (choice?.message?.content) content.push({ type: 'text', text: choice.message.content })
  for (const c of choice?.message?.tool_calls ?? [])
    content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) })
  return {
    content,
    stop_reason: mapFinish(choice?.finish_reason),
    usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
    model: json.model ?? '',
  }
}

export class OpenAIProvider implements Provider {
  readonly name = 'openai'
  private url: string

  constructor(
    private cfg: ProviderConfig,
    private onWire?: WireListener,
  ) {
    this.url = viaProxy(`${(cfg.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, cfg.proxy)
  }

  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    this.onWire?.({ url: this.url, body })
    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw new AbortError()
      throw new LLMError(`网络错误（若是 CORS 问题，请在设置里启用本地代理）：${(e as Error).message}`, 0, true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new LLMError(`${res.status} ${text.slice(0, 500)}`, res.status, res.status === 429 || res.status >= 500)
    }
    return res
  }

  async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    const res = await this.post(toOpenAIBody(req, resolveModel(this.cfg, req.model)), opts?.signal)
    return fromOpenAIResponse(await res.json())
  }

  async *stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent> {
    const body = { ...toOpenAIBody(req, resolveModel(this.cfg, req.model)), stream: true, stream_options: { include_usage: true } }
    const res = await this.post(body, opts?.signal)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let text = ''
    let finish: string | undefined
    let model = ''
    let usage = { input_tokens: 0, output_tokens: 0 }
    const calls: { id: string; name: string; args: string }[] = []
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const chunk = JSON.parse(data)
          model = chunk.model ?? model
          if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 }
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finish = choice.finish_reason
          const d = choice.delta ?? {}
          if (d.content) {
            text += d.content
            yield { type: 'text_delta', text: d.content }
          }
          for (const tc of d.tool_calls ?? []) {
            let c = calls[tc.index]
            if (!c) {
              c = calls[tc.index] = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? '', args: '' }
              yield { type: 'tool_use_start', id: c.id, name: c.name }
            }
            if (tc.function?.arguments) {
              c.args += tc.function.arguments
              yield { type: 'tool_input_delta', id: c.id, partial_json: tc.function.arguments }
            }
          }
        }
      }
    } catch (e) {
      if (opts?.signal?.aborted) throw new AbortError()
      throw e
    }
    const content: ContentBlock[] = []
    if (text) content.push({ type: 'text', text })
    for (const c of calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: parseArgs(c.args) })
    yield { type: 'message_end', response: { content, stop_reason: mapFinish(finish), usage, model } }
  }
}
