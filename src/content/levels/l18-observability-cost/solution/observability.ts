import { chat, countTokens, now, type ChatRequest, type ChatResponse, type ModelTier, type Usage } from 'agent-quest'
import { runAgent, type AgentResult } from './agent'
import type { Tool } from './tools'

export type ChatFn = (req: ChatRequest) => Promise<ChatResponse>

/** 价格表：美元 / 百万 token（MTok），按响应里的 model 计费 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
}

/** 模型档位 → 计费用的模型名（请求阶段还没有响应，只能按档位估算） */
const TIER_MODEL: Record<string, string> = { default: 'mock-default', fast: 'mock-fast' }

export function costOf(model: string, usage: Usage): number {
  const p = PRICES[model] ?? PRICES[TIER_MODEL[model]] ?? PRICES['mock-default'] // 未知模型按贵的算，宁可高估
  return (usage.input_tokens * p.input + usage.output_tokens * p.output) / 1_000_000
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

/** 给 chat 函数埋点：每次调用记录一个 span（失败也要记，然后把错误继续抛出去） */
export function instrument(chatFn: ChatFn, tracer: Tracer, attrs: { feature: string }): ChatFn {
  return async (req) => {
    const start = now()
    try {
      const res = await chatFn(req)
      tracer.record({
        feature: attrs.feature,
        model: res.model,
        latencyMs: now() - start,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: costOf(res.model, res.usage),
      })
      return res
    } catch (e) {
      tracer.record({
        feature: attrs.feature,
        model: TIER_MODEL[req.model ?? 'default'] ?? String(req.model),
        latencyMs: now() - start,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: (e as Error).message,
      })
      throw e
    }
  }
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

/** 最近秩法（nearest-rank）求分位数 */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

/** 按 feature 汇总：调用数、错误数、token、费用、延迟分位数 */
export function summarize(spans: Span[]): Record<string, FeatureStats> {
  const groups: Record<string, Span[]> = {}
  for (const s of spans) (groups[s.feature] ??= []).push(s)
  const out: Record<string, FeatureStats> = {}
  for (const [feature, list] of Object.entries(groups)) {
    const lat = list.map((s) => s.latencyMs).sort((a, b) => a - b)
    out[feature] = {
      calls: list.length,
      errors: list.filter((s) => s.error).length,
      inputTokens: list.reduce((n, s) => n + s.inputTokens, 0),
      outputTokens: list.reduce((n, s) => n + s.outputTokens, 0),
      costUsd: list.reduce((n, s) => n + s.costUsd, 0),
      p50LatencyMs: percentile(lat, 50),
      p95LatencyMs: percentile(lat, 95),
    }
  }
  return out
}

// ------------------------------------------------------------------ 缓存

/** 稳定序列化：对象的键排序后再输出，保证 {a,b} 和 {b,a} 得到同一个 key */
export function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 响应缓存：完全相同的请求直接返回上次的结果（同时合并并发的相同请求） */
export function withCache(chatFn: ChatFn, store: Map<string, Promise<ChatResponse>> = new Map()): ChatFn {
  return async (req) => {
    const key = stableKey(req)
    let hit = store.get(key)
    if (!hit) {
      hit = chatFn(req)
      store.set(key, hit)
      hit.catch(() => store.delete(key)) // 失败的结果不缓存
    }
    return structuredClone(await hit)
  }
}

// ------------------------------------------------------------------ 路由

const NEEDS_TOOLS = /NV-\d{6}|@|订单|物流|快递|退款|取消|帮我|查一下|然后|并且|如果/

/**
 * 模型路由：用零成本的规则判断，而不是再调一次模型来分类。
 * 简单 FAQ（短、不涉及具体订单/多步操作）走 fast，其余走 default。
 * 规则判断错了也只是“贵一点”或“答得差一点”，上线后用评测集校准。
 */
export function routeModel(question: string): ModelTier {
  if (question.length > 40 || NEEDS_TOOLS.test(question)) return 'default'
  return 'fast'
}

// ------------------------------------------------------------------ 预算

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** 预算守卫：调用前预估（已花费 + 本次输入成本），会超预算就拒绝调用 */
export function withBudget(chatFn: ChatFn, opts: { maxUsd: number }): ChatFn & { spent(): number } {
  let spent = 0
  const fn = async (req: ChatRequest) => {
    const estimate = costOf(TIER_MODEL[req.model ?? 'default'] ?? String(req.model), { input_tokens: countTokens(req), output_tokens: 0 })
    if (spent + estimate > opts.maxUsd)
      throw new BudgetExceededError(
        `预算超限：已花费 $${spent.toFixed(6)}，本次预计至少 $${estimate.toFixed(6)}，上限 $${opts.maxUsd}。已停止调用模型。`,
      )
    const res = await chatFn(req)
    spent += costOf(res.model, res.usage)
    return res
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
      // 缓存放在最外层：命中缓存时不产生调用、不产生 span、不花预算
      const chatFn = withCache(instrument(budgeted, tracer, { feature }), cache)
      return runAgent(question, tools, { system: SUPPORT_SYSTEM, model: routeModel(question), chat: chatFn })
    },
    report: () => summarize(tracer.spans),
    spent: () => budgeted.spent(),
  }
}
