import type { MockModel } from '../llm/providers/mock'
import type { Trace, TraceEvent } from '../trace'

export type RunMode = 'mock' | 'real'

export class JudgeFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JudgeFailure'
  }
}

export interface ScenarioCtx {
  mode: RunMode
  /** 加载玩家工作区里的模块，例如 ctx.load('agent.ts') */
  load<T = any>(path: string): T
  /** 用全新的模块系统加载（模拟进程重启：模块级变量全部清空） */
  loadFresh<T = any>(path: string): T
  trace: Trace
  now(): number
  assert(cond: unknown, msg: string): asserts cond
  eq<T>(actual: T, expected: T, msg: string): void
  includes(text: unknown, needle: string | RegExp, msg: string): void
  fail(msg: string): never
}

export interface Scenario {
  id: string
  title: string
  /** 依赖 mock 的故障注入，真实模式下跳过 */
  mockOnly?: boolean
  run(ctx: ScenarioCtx): Promise<void>
}

export interface LevelSuite {
  scenarios: Scenario[]
  mock: MockModel
  /** 星级预算（所有场景合计）：★★ 调用次数达标，★★★ token 达标 */
  budgets: { calls: number; tokens: number }
  maxCallsPerScenario?: number
}

export interface ScenarioResult {
  id: string
  title: string
  status: 'passed' | 'failed' | 'error' | 'skipped'
  message?: string
  events: TraceEvent[]
  calls: number
  tokens: number
  elapsedMs: number
}

export interface SuiteResult {
  mode: RunMode
  passed: boolean
  stars: number
  results: ScenarioResult[]
  totals: { calls: number; tokens: number }
  budgets: { calls: number; tokens: number }
}
