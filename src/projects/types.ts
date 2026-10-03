import type { RunMode } from '../engine/judge/types'
import type { MockModel } from '../engine/llm/providers/mock'
import type { ChatRequest, ChatResponse } from '../engine/llm/types'
import type { Trace, TraceEvent } from '../engine/trace'
import { L } from '../engine/locale'

/** 1 入门 · 2 进阶 · 3 高级 · 4 专家 */
export type Tier = 1 | 2 | 3 | 4

export const TIER_NAMES: Record<Tier, string> = L(
  { 1: '入门', 2: '进阶', 3: '高级', 4: '专家' },
  { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' },
)

export interface CheckResult {
  pass: boolean
  /** 判定理由（中文，失败时要说明哪里不对） */
  reason: string
}

/** 创建环境时拿到的上下文：所有副作用都要通过这里，保证并发运行时互不干扰 */
export interface EnvCtx {
  mode: RunMode
  taskId: string
  /** 包装一个环境 API，调用会记录到 trace */
  traced<A extends unknown[], R>(name: string, fn: (...args: A) => R | Promise<R>): (...args: A) => Promise<R>
  /** 模拟 I/O 延迟（虚拟时间） */
  delay(ms: number): Promise<void>
  /** 写一条日志到 trace */
  log(message: string): void
  /** 真实模式下给模拟用户等“环境角色”用的模型调用，不计入玩家的成本 */
  envChat?: (req: ChatRequest) => Promise<ChatResponse>
}

export interface CheckCtx<Env, Out> {
  env: Env
  output: Out
  trace: Trace
  mode: RunMode
}

export interface ProjectTask<Env = any, Out = any> {
  id: string
  title: string
  /** 核心任务：有模拟模型脚本，参与评星；非核心任务只在真实模型基准中运行 */
  core: boolean
  /** 交给玩家入口函数的输入 */
  input: any
  check(ctx: CheckCtx<Env, Out>): CheckResult | Promise<CheckResult>
}

export interface ProjectDef<Env = any, Out = any> {
  id: string
  number: number
  tier: Tier
  title: string
  tagline: string
  /** 甲方 */
  client: string
  prototype: { name: string; url: string }
  concepts: string[]
  /** 甲方需求文档（Markdown） */
  brief: string
  /** 生产要点与参考架构提示（Markdown） */
  guide: string
  /** 入口文件，玩家必须导出 contract 中约定的函数 */
  entry: string
  /** 接口约定（Markdown 代码块），显示在需求文档旁边 */
  contract: string
  starter: Record<string, string>
  solution: Record<string, string>
  /** 可以是异步的（例如需要初始化 SQLite） */
  createEnv(task: ProjectTask<Env, Out>, ctx: EnvCtx): Env | Promise<Env>
  /** 如何调用玩家的入口模块 */
  invoke(mod: any, task: ProjectTask<Env, Out>, env: Env): Promise<Out>
  tasks: ProjectTask<Env, Out>[]
  mock: MockModel
  /** 评星：★ 核心通过率 ≥ passThreshold；★★ 核心全部通过；★★★ 全部通过且 token ≤ tokenBudget */
  passThreshold: number
  tokenBudget: number
  maxCallsPerTask?: number
}

export interface TaskRunResult {
  taskId: string
  trial: number
  title: string
  status: 'passed' | 'failed' | 'error'
  reason: string
  events: TraceEvent[]
  calls: number
  inputTokens: number
  outputTokens: number
  elapsedMs: number
}

export interface ProjectSummary {
  tasks: number
  trials: number
  /** 所有试验的平均成功率 */
  passAt1: number
  /** 所有 k 次试验都成功的任务占比（τ-bench 的可靠性指标） */
  passHatK: number
  totalTokens: number
  avgTokensPerTask: number
  p50Ms: number
  p95Ms: number
  costUsd: number | null
}

export interface ProjectRunResult {
  projectId: string
  mode: RunMode
  results: TaskRunResult[]
  summary: ProjectSummary
  stars: number
  startedAt: number
}
