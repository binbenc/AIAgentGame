import { AbortError, chatStream, sleep, type Message, type ToolUseBlock } from 'agent-quest'
import { executeToolCalls, type AgentOptions } from './agent'
import { NOVA_SYSTEM } from './llm'
import { textOf, type Tool } from './tools'

export interface StreamOptions {
  /** 用户点了“停止生成”时 abort 它 */
  signal?: AbortSignal
  /** 多久没收到第一个字就放弃（毫秒） */
  firstTokenTimeoutMs?: number
  system?: string
}

export interface StreamResult {
  text: string
  cancelled: boolean
  timedOut?: boolean
}

export async function streamAnswer(question: string, onText: (delta: string) => void, opts: StreamOptions = {}): Promise<StreamResult> {
  // 自己的 AbortController：用户取消、首字超时，都通过它真正中止请求
  const ac = new AbortController()
  const forward = () => ac.abort()
  if (opts.signal?.aborted) ac.abort()
  else opts.signal?.addEventListener('abort', forward)

  // 首字超时：到点还没收到第一个字，就中止请求
  const timer = new AbortController()
  let timedOut = false
  if (opts.firstTokenTimeoutMs) {
    sleep(opts.firstTokenTimeoutMs, timer.signal).then(
      () => {
        timedOut = true
        ac.abort()
      },
      () => {}, // 计时器被取消（已经收到首字）
    )
  }

  let text = ''
  try {
    const stream = chatStream(
      { system: opts.system ?? NOVA_SYSTEM, messages: [{ role: 'user', content: question }] },
      { signal: ac.signal },
    )
    for await (const e of stream) {
      if (e.type !== 'text_delta') continue
      timer.abort() // 首字已到，取消超时计时器
      text += e.text
      onText(e.text)
    }
    return { text, cancelled: false }
  } catch (e) {
    if (e instanceof AbortError || ac.signal.aborted) return timedOut ? { text, cancelled: false, timedOut: true } : { text, cancelled: true }
    throw e
  } finally {
    timer.abort()
    opts.signal?.removeEventListener('abort', forward)
  }
}

export interface AgentStreamCallbacks {
  onText?(delta: string): void
  /** 进度提示，例如“正在调用工具 get_shipping…” */
  onStatus?(status: string): void
}

/** 流式版的 Agent 循环：文字边生成边推送，调用工具时推送进度 */
export async function streamAgent(
  task: string,
  tools: Tool[],
  cb: AgentStreamCallbacks = {},
  opts: AgentOptions & { signal?: AbortSignal } = {},
): Promise<{ output: string; messages: Message[] }> {
  const messages: Message[] = [{ role: 'user', content: task }]
  const maxSteps = opts.maxSteps ?? 10
  for (let step = 1; step <= maxSteps; step++) {
    const stream = chatStream(
      { system: opts.system, model: opts.model, tools: tools.map((t) => t.spec), messages },
      { signal: opts.signal },
    )
    for await (const e of stream) {
      if (e.type === 'text_delta') cb.onText?.(e.text)
      else if (e.type === 'tool_use_start') cb.onStatus?.(`正在调用工具 ${e.name}…`)
    }
    const res = await stream.finalResponse()
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'tool_use') return { output: textOf(res.content), messages }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    messages.push({ role: 'user', content: await executeToolCalls(calls, tools, opts) })
  }
  return { output: '', messages }
}
