import { chat, countTokens, now, type ChatRequest, type ChatResponse, type ModelTier, type Usage } from 'agent-quest'
import { runAgent, type AgentResult } from './agent'
import type { Tool } from './tools'

export type ChatFn = (req: ChatRequest) => Promise<ChatResponse>

/** 价格表：美元 / 百万 token（MTok），按响应里的 model 计费 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
}

export function costOf(model: string, usage: Usage): number {
  // TODO：(输入 token × 输入单价 + 输出 token × 输出单价) / 1_000_000
  //       model 也可能是档位名 'default' / 'fast'；未知模型按 mock-default 计（宁可高估）
  return 0
}

// ------------------------------------------------------------------ 埋点

export interface Span {
  feature: string
  model: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  error?: string
}

export interface Tracer {
  spans: Span[]
  record(span: Span): void
}

export function createTracer(): Tracer {
  const spans: Span[] = []
  return { spans, record: (s) => void spans.push(s) }
}

/** 给 chat 函数埋点：每次调用记录一个 span */
export function instrument(chatFn: ChatFn, tracer: Tracer, attrs: { feature: string }): ChatFn {
  // TODO：调用前后用 now() 计时；成功时按响应的 model / usage 记录 span（含 costUsd）
  //       失败时也要记一个带 error 的 span（token 和费用记 0），然后把错误继续抛出去
  void now
  return chatFn
}

export interface FeatureStats {
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  p50LatencyMs: number
  p95LatencyMs: number
}

/** 按 feature 汇总：调用数、错误数、token、费用、延迟分位数（最近秩法） */
export function summarize(spans: Span[]): Record<string, FeatureStats> {
  // TODO：按 span.feature 分组累加；分位数 = 升序排序后第 ceil(p/100 × n) 个（从 1 数）
  return {}
}

// ------------------------------------------------------------------ 缓存

/** 稳定序列化：对象的键排序后再输出，保证 {a,b} 和 {b,a} 得到同一个 key */
export function stableKey(value: unknown): string {
  // TODO：递归处理数组（保持顺序）和对象（键排序，跳过 undefined）
  return JSON.stringify(value)
}

/** 响应缓存：完全相同的请求直接返回上次的结果 */
export function withCache(chatFn: ChatFn, store: Map<string, Promise<ChatResponse>> = new Map()): ChatFn {
  // TODO：key = stableKey(req)；命中就返回缓存（建议 structuredClone 一份）；失败的结果不要缓存
  void store
  return chatFn
}

// ------------------------------------------------------------------ 路由

/** 模型路由：简单 FAQ 走 'fast'，需要查订单、多步操作的走 'default' */
export function routeModel(question: string): ModelTier {
  // TODO：用零成本的规则判断（长度、订单号、邮箱、“帮我/取消/退款/然后”等关键词……）
  return 'default'
}

// ------------------------------------------------------------------ 预算

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** 预算守卫：会超预算就拒绝调用 */
export function withBudget(chatFn: ChatFn, opts: { maxUsd: number }): ChatFn & { spent(): number } {
  let spent = 0
  const fn = async (req: ChatRequest) => {
    // TODO：调用前预估：已花费 + 本次输入成本（countTokens(req) 个输入 token，按 req.model 档位的单价）
    //       超过 opts.maxUsd 就 throw new BudgetExceededError('预算超限：...')
    //       调用后把实际费用累加进 spent
    void countTokens
    return chatFn(req)
  }
  return Object.assign(fn, { spent: () => spent })
}

// ------------------------------------------------------------------ 组合

export const SUPPORT_SYSTEM = '你是 Nova 科技客服 Agent。'

export function createSupportBot(tools: Tool[], opts: { maxUsd?: number } = {}) {
  const tracer = createTracer()
  const cache = new Map<string, Promise<ChatResponse>>()
  const budgeted = withBudget(chat, { maxUsd: opts.maxUsd ?? 1 })
  return {
    tracer,
    async answer(question: string, feature: string): Promise<AgentResult> {
      // TODO：组合 withCache(instrument(budgeted, tracer, { feature }), cache)，
      //       用 routeModel 选模型，通过 runAgent 的 opts.chat 注入（需要先改 agent.ts）
      void cache
      return runAgent(question, tools, { system: SUPPORT_SYSTEM })
    },
    report: () => summarize(tracer.spans),
    spent: () => budgeted.spent(),
  }
}
