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
  // Current approach: wait for the model to finish, then hand everything to the UI at once. Users stare at a blank screen for seconds
  const stream = chatStream({ system: opts.system ?? NOVA_SYSTEM, messages: [{ role: 'user', content: question }] })
  const res = await stream.finalResponse()
  const text = textOf(res.content)
  onText(text)
  return { text, cancelled: false }

  // TODO:
  //   1. Handle events one by one with for await (const e of stream); on each text_delta, call onText(e.text) right away
  //   2. Cancellation: create your own AbortController that aborts when opts.signal aborts; pass its signal to chatStream(req, { signal })
  //      Catch AbortError and return the partial text + cancelled: true
  //   3. First-token timeout: if sleep(firstTokenTimeoutMs, timer.signal) fires before the first token, abort the request and return timedOut: true;
  //      cancel that timer once the first token arrives
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
  // TODO: the same loop as runAgent, but use chatStream for every turn:
  //   - text_delta → cb.onText; tool_use_start → cb.onStatus(`Calling tool ${e.name}…`)
  //   - after the events, await stream.finalResponse() for the full response, then run the tools as before and keep looping
  throw new Error('TODO: implement streamAgent()')
}
