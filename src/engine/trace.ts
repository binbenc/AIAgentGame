import type { ChatRequest, ChatResponse } from './llm/types'

export type TraceEvent =
  | {
      kind: 'llm'
      seq: number
      t: number
      durationMs: number
      streamed: boolean
      request: ChatRequest
      response?: ChatResponse
      error?: string
      wire?: { url: string; body: unknown }
    }
  | { kind: 'tool'; seq: number; t: number; durationMs: number; name: string; input: unknown; output?: unknown; error?: string }
  | { kind: 'log'; seq: number; t: number; message: string }
  | { kind: 'sleep'; seq: number; t: number; ms: number }
  | { kind: 'error'; seq: number; t: number; message: string }

type Omit2<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
export type NewTraceEvent = Omit2<TraceEvent, 'seq'>

export class Trace {
  readonly events: TraceEvent[] = []
  private seq = 0
  constructor(private listener?: (e: TraceEvent) => void) {}

  add(e: NewTraceEvent): TraceEvent {
    const ev = { ...e, seq: ++this.seq } as TraceEvent
    this.events.push(ev)
    this.listener?.(ev)
    return ev
  }

  llmCalls() {
    return this.events.filter((e): e is Extract<TraceEvent, { kind: 'llm' }> => e.kind === 'llm')
  }
  toolCalls(name?: string) {
    return this.events.filter(
      (e): e is Extract<TraceEvent, { kind: 'tool' }> => e.kind === 'tool' && (!name || e.name === name),
    )
  }
  logs(): string[] {
    return this.events.filter((e) => e.kind === 'log').map((e) => (e as { message: string }).message)
  }
  totalTokens(): { input: number; output: number; total: number } {
    let input = 0
    let output = 0
    for (const c of this.llmCalls()) {
      input += c.response?.usage.input_tokens ?? 0
      output += c.response?.usage.output_tokens ?? 0
    }
    return { input, output, total: input + output }
  }
}
