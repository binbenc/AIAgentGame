/**
 * 项目运行器：把每个任务放进独立的运行时（时钟、网关、trace、模块系统）里执行，
 * 支持多次试验（pass^k）和有界并发。判定由任务自带的 check() 完成，与模型无关。
 */
import * as z from 'zod'
import { RealClock, VirtualClock } from '../engine/clock'
import type { RunMode } from '../engine/judge/types'
import { Gateway } from '../engine/llm/gateway'
import type { WireListener } from '../engine/llm/providers/config'
import { MockProvider } from '../engine/llm/providers/mock'
import type { ChatRequest, Provider } from '../engine/llm/types'
import * as api from '../engine/runtime/api'
import { createModuleSystem } from '../engine/sandbox/loader'
import { Trace, type TraceEvent } from '../engine/trace'
import { priceOf } from './pricing'
import type { EnvCtx, ProjectDef, ProjectRunResult, ProjectSummary, TaskRunResult } from './types'

export interface ProjectRunOptions {
  project: ProjectDef
  files: Record<string, string>
  mode: RunMode
  /** 只跑这些任务；默认：模拟模式跑核心任务，真实模式跑全部任务 */
  taskIds?: string[]
  trials?: number
  concurrency?: number
  realProvider?: (onWire: WireListener) => Provider
  onTaskStart?: (key: string) => void
  onEvent?: (key: string, e: TraceEvent) => void
  onTaskEnd?: (r: TaskRunResult) => void
}

const ZOD = { ...z, z, default: z }

export function taskKey(taskId: string, trial: number): string {
  return trial > 1 ? `${taskId}#${trial}` : taskId
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

export function selectTasks(project: ProjectDef, mode: RunMode, taskIds?: string[]) {
  return project.tasks.filter((t) => (taskIds ? taskIds.includes(t.id) : mode === 'real' || t.core))
}

async function runTask(opts: ProjectRunOptions, taskId: string, trial: number): Promise<TaskRunResult> {
  const { project, files, mode } = opts
  const task = project.tasks.find((t) => t.id === taskId)!
  const key = taskKey(taskId, trial)
  opts.onTaskStart?.(key)
  const clock = mode === 'mock' ? new VirtualClock() : new RealClock()
  const trace = new Trace((e) => opts.onEvent?.(key, e))
  let gateway!: Gateway
  const provider =
    mode === 'mock'
      ? new MockProvider(project.mock, taskId, clock)
      : opts.realProvider!((w) => {
          gateway.lastWire = w
        })
  gateway = new Gateway(provider, trace, clock, { maxCalls: project.maxCallsPerTask ?? 40 })
  const runtime = { gateway, clock, trace }
  const bound = api.createApi(() => runtime)
  const modules = createModuleSystem(files, { 'agent-quest': { ...api, ...bound }, zod: ZOD })

  // 环境角色（例如模拟用户）在真实模式下用的模型：不经过玩家的网关，不计入成本
  const envProvider = mode === 'real' ? opts.realProvider!(() => {}) : undefined
  const ctx: EnvCtx = {
    mode,
    taskId,
    traced: (name, fn) => async (...args) => {
      const t = clock.now()
      const input = args.length === 1 ? args[0] : args
      try {
        const output = await fn(...args)
        trace.add({ kind: 'tool', t, durationMs: clock.now() - t, name, input: clone(input), output: clone(output) })
        return output
      } catch (e) {
        trace.add({ kind: 'tool', t, durationMs: clock.now() - t, name, input: clone(input), error: (e as Error).message })
        throw e
      }
    },
    delay: (ms) => clock.sleep(ms),
    log: (message) => void trace.add({ kind: 'log', t: clock.now(), message }),
    envChat: envProvider ? (req: ChatRequest) => envProvider.chat(req) : undefined,
  }

  let status: TaskRunResult['status'] = 'passed'
  let reason = ''
  try {
    const env = project.createEnv(task, ctx)
    const mod = modules.require(project.entry)
    const output = await project.invoke(mod, task, env)
    const verdict = await task.check({ env, output, trace, mode })
    status = verdict.pass ? 'passed' : 'failed'
    reason = verdict.reason
  } catch (e) {
    status = 'error'
    reason = `${(e as Error)?.name ?? 'Error'}: ${(e as Error)?.message ?? String(e)}`
    trace.add({ kind: 'error', t: clock.now(), message: reason })
  } finally {
    gateway.close()
  }
  const calls = trace.llmCalls()
  const r: TaskRunResult = {
    taskId,
    trial,
    title: task.title,
    status,
    reason,
    events: trace.events,
    calls: calls.length,
    inputTokens: calls.reduce((n, c) => n + (c.response?.usage.input_tokens ?? 0), 0),
    outputTokens: calls.reduce((n, c) => n + (c.response?.usage.output_tokens ?? 0), 0),
    elapsedMs: clock.now(),
  }
  opts.onTaskEnd?.(r)
  return r
}

function clone(v: unknown): unknown {
  try {
    return structuredClone(v)
  } catch {
    return String(v)
  }
}

export function summarize(results: TaskRunResult[], costUsd: number | null): ProjectSummary {
  const byTask = new Map<string, TaskRunResult[]>()
  for (const r of results) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r])
  const tokens = results.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0)
  const trials = Math.max(1, ...[...byTask.values()].map((v) => v.length))
  return {
    tasks: byTask.size,
    trials,
    passAt1: results.length ? results.filter((r) => r.status === 'passed').length / results.length : 0,
    passHatK: byTask.size ? [...byTask.values()].filter((v) => v.every((r) => r.status === 'passed')).length / byTask.size : 0,
    totalTokens: tokens,
    avgTokensPerTask: results.length ? Math.round(tokens / results.length) : 0,
    p50Ms: percentile(results.map((r) => r.elapsedMs), 50),
    p95Ms: percentile(results.map((r) => r.elapsedMs), 95),
    costUsd,
  }
}

export function costOf(results: TaskRunResult[]): number | null {
  let total = 0
  for (const r of results)
    for (const e of r.events) {
      if (e.kind !== 'llm' || !e.response) continue
      const p = priceOf(e.response.model)
      if (!p) return null
      total += (e.response.usage.input_tokens * p.input + e.response.usage.output_tokens * p.output) / 1_000_000
    }
  return total
}

export function starsOf(project: ProjectDef, mode: RunMode, summary: ProjectSummary): number {
  if (mode !== 'mock') return 0
  if (summary.passAt1 < project.passThreshold) return 0
  if (summary.passAt1 < 1) return 1
  return summary.totalTokens <= project.tokenBudget ? 3 : 2
}

export async function runProject(opts: ProjectRunOptions): Promise<ProjectRunResult> {
  const startedAt = Date.now()
  const trials = opts.mode === 'mock' ? 1 : Math.max(1, opts.trials ?? 1)
  const jobs = selectTasks(opts.project, opts.mode, opts.taskIds).flatMap((t) =>
    Array.from({ length: trials }, (_, i) => [t.id, i + 1] as const),
  )
  const results: TaskRunResult[] = []
  const concurrency = Math.max(1, opts.concurrency ?? 1)
  let next = 0
  async function worker() {
    while (next < jobs.length) {
      const [id, trial] = jobs[next++]
      results.push(await runTask(opts, id, trial))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
  const order = new Map(jobs.map(([id, t], i) => [taskKey(id, t), i]))
  results.sort((a, b) => order.get(taskKey(a.taskId, a.trial))! - order.get(taskKey(b.taskId, b.trial))!)
  const summary = summarize(results, costOf(results))
  return { projectId: opts.project.id, mode: opts.mode, results, summary, stars: starsOf(opts.project, opts.mode, summary), startedAt }
}
