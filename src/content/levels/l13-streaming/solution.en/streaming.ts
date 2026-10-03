import { AbortError, chatStream, sleep, type Message, type ToolUseBlock } from 'agent-quest'
import { executeToolCalls, type AgentOptions } from './agent'
import { NOVA_SYSTEM } from './llm'
import { textOf, type Tool } from './tools'

export interface StreamOptions {
  /** Aborted when the user clicks "Stop generating" */
  signal?: AbortSignal
  /** Give up if the first token hasn't arrived after this many milliseconds */
  firstTokenTimeoutMs?: number
  system?: string
}

export interface StreamResult {
  text: string
  cancelled: boolean
  timedOut?: boolean
}

export async function streamAnswer(question: string, onText: (delta: string) => void, opts: StreamOptions = {}): Promise<StreamResult> {
  // Our own AbortController: both user cancellation and the first-token timeout really abort the request through it
  const ac = new AbortController()
  const forward = () => ac.abort()
  if (opts.signal?.aborted) ac.abort()
  else opts.signal?.addEventListener('abort', forward)

  // First-token timeout: abort the request if the first token hasn't arrived in time
  const timer = new AbortController()
  let timedOut = false
  if (opts.firstTokenTimeoutMs) {
    sleep(opts.firstTokenTimeoutMs, timer.signal).then(
      () => {
        timedOut = true
        ac.abort()
      },
      () => {}, // Timer cancelled (the first token already arrived)
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
      timer.abort() // First token is here: cancel the timeout timer
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
  /** Progress updates, e.g. "Calling tool get_shipping…" */
  onStatus?(status: string): void
}

/** Streaming agent loop: push text as it's generated, and progress while calling tools */
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
      else if (e.type === 'tool_use_start') cb.onStatus?.(`Calling tool ${e.name}…`)
    }
    const res = await stream.finalResponse()
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'tool_use') return { output: textOf(res.content), messages }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    messages.push({ role: 'user', content: await executeToolCalls(calls, tools, opts) })
  }
  return { output: '', messages }
}
