import Anthropic from '@anthropic-ai/sdk'
import { StreamAccumulator } from '../stream'
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

const DEFAULT_MAX_TOKENS = 8192

export function toAnthropicParams(req: ChatRequest, model: string): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : (m.content.map((b) => {
            switch (b.type) {
              case 'text':
                return { type: 'text', text: b.text }
              case 'tool_use':
                return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
              case 'tool_result':
                return { type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error }
              case 'opaque':
                // thinking 等块必须原样回传
                return b.raw
            }
          }) as Anthropic.ContentBlockParam[]),
  }))
  return {
    model,
    max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
    ...(req.system ? { system: req.system } : {}),
    ...(req.tools?.length
      ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })) }
      : {}),
    messages,
  }
}

function fromAnthropicBlock(b: Anthropic.ContentBlock): ContentBlock {
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
  return { type: 'opaque', provider: 'anthropic', raw: b }
}

function mapStop(s: string | null): StopReason {
  if (s === 'end_turn' || s === 'stop_sequence') return 'end_turn'
  if (s === 'tool_use') return 'tool_use'
  if (s === 'max_tokens') return 'max_tokens'
  if (s === 'refusal') return 'refusal'
  return 'other'
}

export function fromAnthropicMessage(m: Anthropic.Message): ChatResponse {
  return {
    content: m.content.map(fromAnthropicBlock),
    stop_reason: mapStop(m.stop_reason),
    usage: { input_tokens: m.usage.input_tokens, output_tokens: m.usage.output_tokens },
    model: m.model,
  }
}

function mapError(e: unknown): Error {
  if (e instanceof Anthropic.APIUserAbortError) return new AbortError()
  if (e instanceof Anthropic.APIConnectionError) return new LLMError(`网络错误：${e.message}`, 0, true)
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0
    return new LLMError(`${status} ${e.message}`, status, status === 408 || status === 409 || status === 429 || status >= 500)
  }
  return e instanceof Error ? e : new Error(String(e))
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic'
  private client: Anthropic
  private base: string

  constructor(
    private cfg: ProviderConfig,
    private onWire?: WireListener,
  ) {
    this.base = viaProxy(cfg.baseURL || 'https://api.anthropic.com', cfg.proxy)
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: this.base,
      dangerouslyAllowBrowser: true,
      maxRetries: 0, // 重试策略由玩家自己实现（第 6 关）
    })
  }

  async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
    const params = toAnthropicParams(req, resolveModel(this.cfg, req.model))
    this.onWire?.({ url: `${this.base}/v1/messages`, body: params })
    try {
      const msg = await this.client.messages.create(params, { signal: opts?.signal })
      return fromAnthropicMessage(msg)
    } catch (e) {
      throw mapError(e)
    }
  }

  async *stream(req: ChatRequest, opts?: ChatOptions): AsyncIterable<StreamEvent> {
    const params = toAnthropicParams(req, resolveModel(this.cfg, req.model))
    this.onWire?.({ url: `${this.base}/v1/messages`, body: { ...params, stream: true } })
    const acc = new StreamAccumulator()
    const ids = new Map<number, string>()
    try {
      const stream = this.client.messages.stream(params, { signal: opts?.signal })
      for await (const ev of stream) {
        let out: StreamEvent | undefined
        if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
          ids.set(ev.index, ev.content_block.id)
          out = { type: 'tool_use_start', id: ev.content_block.id, name: ev.content_block.name }
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta') out = { type: 'text_delta', text: ev.delta.text }
          else if (ev.delta.type === 'input_json_delta')
            out = { type: 'tool_input_delta', id: ids.get(ev.index) ?? '', partial_json: ev.delta.partial_json }
        }
        if (out) {
          acc.apply(out)
          yield out
        }
      }
      yield { type: 'message_end', response: fromAnthropicMessage(await stream.finalMessage()) }
    } catch (e) {
      throw mapError(e)
    }
  }
}
