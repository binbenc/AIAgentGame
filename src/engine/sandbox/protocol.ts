import type { ScenarioResult, SuiteResult, RunMode } from '../judge/types'
import type { ChatRequest, ChatResponse, StreamEvent } from '../llm/types'
import type { TraceEvent } from '../trace'

export interface SerializedError {
  name: string
  message: string
  status?: number
  retryable?: boolean
}

/** 宿主 → Worker */
export type HostMessage =
  | { type: 'run'; levelId: string; files: Record<string, string>; mode: RunMode; only?: string[] }
  | { type: 'llm-result'; id: number; res: ChatResponse }
  | { type: 'llm-event'; id: number; event: StreamEvent }
  | { type: 'llm-end'; id: number }
  | { type: 'llm-error'; id: number; error: SerializedError }
  | { type: 'llm-wire'; id: number; wire: { url: string; body: unknown } }

/** Worker → 宿主 */
export type WorkerMessage =
  | { type: 'llm'; id: number; req: ChatRequest; stream: boolean }
  | { type: 'llm-abort'; id: number }
  | { type: 'scenario-start'; id: string }
  | { type: 'event'; scenario: string; event: TraceEvent }
  | { type: 'scenario-end'; result: ScenarioResult }
  | { type: 'done'; result: SuiteResult }
  | { type: 'fatal'; error: SerializedError }
