import * as z from 'zod'
import { RealClock, VirtualClock } from '../clock'
import { Gateway } from '../llm/gateway'
import type { WireListener } from '../llm/providers/config'
import { MockProvider } from '../llm/providers/mock'
import type { Provider } from '../llm/types'
import * as api from '../runtime/api'
import { createModuleSystem } from '../sandbox/loader'
import { Trace, type TraceEvent } from '../trace'
import { JudgeFailure, type LevelSuite, type RunMode, type ScenarioCtx, type ScenarioResult, type SuiteResult } from './types'
import { L } from '../locale'

export interface RunOptions {
  suite: LevelSuite
  files: Record<string, string>
  mode: RunMode
  /** 真实模式下构造 provider；onWire 用来记录原始 HTTP 报文 */
  realProvider?: (onWire: WireListener) => Provider
  onEvent?: (scenarioId: string, e: TraceEvent) => void
  onScenarioStart?: (id: string) => void
  onScenarioEnd?: (r: ScenarioResult) => void
  only?: string[]
}

const ZOD = { ...z, z, default: z }

function show(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s && s.length > 300 ? s.slice(0, 300) + '…' : String(s)
}

export async function runSuite(opts: RunOptions): Promise<SuiteResult> {
  const { suite, files, mode } = opts
  const results: ScenarioResult[] = []

  for (const sc of suite.scenarios) {
    if (opts.only && !opts.only.includes(sc.id)) continue
    if (mode === 'real' && sc.mockOnly) {
      const r: ScenarioResult = { id: sc.id, title: sc.title, status: 'skipped', message: L('依赖模拟故障注入，真实模式下跳过', 'Relies on injected mock failures; skipped in real mode'), events: [], calls: 0, tokens: 0, elapsedMs: 0 }
      results.push(r)
      opts.onScenarioEnd?.(r)
      continue
    }
    opts.onScenarioStart?.(sc.id)
    const clock = mode === 'mock' ? new VirtualClock() : new RealClock()
    const trace = new Trace((e) => opts.onEvent?.(sc.id, e))
    let gateway!: Gateway
    const provider =
      mode === 'mock'
        ? new MockProvider(suite.mock, sc.id, clock)
        : opts.realProvider!((w) => {
            gateway.lastWire = w
          })
    gateway = new Gateway(provider, trace, clock, { maxCalls: suite.maxCallsPerScenario ?? 40 })
    const runtime = { gateway, clock, trace }
    api.__setRuntime(runtime)
    const BUILTINS = { 'agent-quest': { ...api, ...api.createApi(() => runtime) }, zod: ZOD }
    const modules = createModuleSystem(files, BUILTINS)

    const ctx: ScenarioCtx = {
      mode,
      trace,
      load: (p) => modules.require(p) as never,
      loadFresh: (p) => createModuleSystem(files, BUILTINS).require(p) as never,
      now: () => clock.now(),
      assert(cond, msg) {
        if (!cond) throw new JudgeFailure(msg)
      },
      eq(actual, expected, msg) {
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new JudgeFailure(`${msg}\n  ${L('期望：', 'Expected: ')}${show(expected)}\n  ${L('实际：', 'Actual:   ')}${show(actual)}`)
      },
      includes(text, needle, msg) {
        const s = typeof text === 'string' ? text : JSON.stringify(text ?? '')
        const ok = typeof needle === 'string' ? s.includes(needle) : needle.test(s)
        if (!ok) throw new JudgeFailure(`${msg}\n  ${L('期望包含：', 'Expected to include: ')}${String(needle)}\n  ${L('实际：', 'Actual: ')}${show(s)}`)
      },
      fail(msg) {
        throw new JudgeFailure(msg)
      },
    }

    let status: ScenarioResult['status'] = 'passed'
    let message: string | undefined
    try {
      await sc.run(ctx)
    } catch (e) {
      const err = e as Error
      status = err instanceof JudgeFailure ? 'failed' : 'error'
      message = err instanceof JudgeFailure ? err.message : `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`
      if (status === 'error') trace.add({ kind: 'error', t: clock.now(), message })
    } finally {
      gateway.close()
      api.__setRuntime(null)
    }
    const r: ScenarioResult = {
      id: sc.id,
      title: sc.title,
      status,
      message,
      events: trace.events,
      calls: trace.llmCalls().length,
      tokens: trace.totalTokens().total,
      elapsedMs: clock.now(),
    }
    results.push(r)
    opts.onScenarioEnd?.(r)
  }

  const ran = results.filter((r) => r.status !== 'skipped')
  const passed = ran.length > 0 && ran.every((r) => r.status === 'passed')
  const totals = { calls: ran.reduce((n, r) => n + r.calls, 0), tokens: ran.reduce((n, r) => n + r.tokens, 0) }
  const stars = !passed || mode === 'real' ? (passed ? 1 : 0) : 1 + (totals.calls <= suite.budgets.calls ? 1 : 0) + (totals.tokens <= suite.budgets.tokens ? 1 : 0)
  return { mode, passed, stars, results, totals, budgets: suite.budgets }
}
