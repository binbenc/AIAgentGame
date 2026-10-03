import { chat, countTokens, now, type ChatRequest, type ChatResponse, type ModelTier, type Usage } from 'agent-quest'
import { runAgent, type AgentResult } from './agent'
import type { Tool } from './tools'

export type ChatFn = (req: ChatRequest) => Promise<ChatResponse>

/** Price table: USD per million tokens (MTok), billed by the model in the response */
export const PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
}

/** Model tier → model name for pricing (before the call there's no response yet, so estimate by tier) */
const TIER_MODEL: Record<string, string> = { default: 'mock-default', fast: 'mock-fast' }

export function costOf(model: string, usage: Usage): number {
  const p = PRICES[model] ?? PRICES[TIER_MODEL[model]] ?? PRICES['mock-default'] // price unknown models as the expensive one; better to overestimate
  return (usage.input_tokens * p.input + usage.output_tokens * p.output) / 1_000_000
}

// ------------------------------------------------------------------ Tracing

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

/** Instrument a chat function: record one span per call (failures too, then re-throw the error) */
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

/** Nearest-rank percentile */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

/** Summarize by feature: calls, errors, tokens, cost, latency percentiles */
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

// ------------------------------------------------------------------ Caching

/** Stable serialization: sort object keys before output so {a,b} and {b,a} get the same key */
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

/** Response cache: an identical request gets the previous result back (concurrent identical requests are merged too) */
export function withCache(chatFn: ChatFn, store: Map<string, Promise<ChatResponse>> = new Map()): ChatFn {
  return async (req) => {
    const key = stableKey(req)
    let hit = store.get(key)
    if (!hit) {
      hit = chatFn(req)
      store.set(key, hit)
      hit.catch(() => store.delete(key)) // don't cache failures
    }
    return structuredClone(await hit)
  }
}

// ------------------------------------------------------------------ Routing

const NEEDS_TOOLS = /NV-\d{6}|@|订单|物流|快递|退款|取消|帮我|查一下|然后|并且|如果|\b(orders?|shipping|shipped|tracking|refunds?|cancel|help me|look up|then|and also|if)\b/i

/**
 * Model routing: decide with zero-cost rules instead of spending another model call to classify.
 * Simple FAQs (short, no specific order, no multi-step work) go to fast; everything else goes to default.
 * When the rules get it wrong the cost is just "a bit pricier" or "a slightly worse answer"; calibrate with your eval set after launch.
 */
export function routeModel(question: string): ModelTier {
  if (question.length > 80 || NEEDS_TOOLS.test(question)) return 'default'
  return 'fast'
}

// ------------------------------------------------------------------ Budget

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** Budget guard: estimate before calling (spent so far + this call's input cost) and refuse anything that would go over budget */
export function withBudget(chatFn: ChatFn, opts: { maxUsd: number }): ChatFn & { spent(): number } {
  let spent = 0
  const fn = async (req: ChatRequest) => {
    const estimate = costOf(TIER_MODEL[req.model ?? 'default'] ?? String(req.model), { input_tokens: countTokens(req), output_tokens: 0 })
    if (spent + estimate > opts.maxUsd)
      throw new BudgetExceededError(
        `Budget exceeded: spent $${spent.toFixed(6)}, this call needs at least $${estimate.toFixed(6)}, limit is $${opts.maxUsd}. Stopped calling the model.`,
      )
    const res = await chatFn(req)
    spent += costOf(res.model, res.usage)
    return res
  }
  return Object.assign(fn, { spent: () => spent })
}

// ------------------------------------------------------------------ Putting it together

export const SUPPORT_SYSTEM = "You are Nova Tech's support agent."

export function createSupportBot(tools: Tool[], opts: { maxUsd?: number } = {}) {
  const tracer = createTracer()
  const cache = new Map<string, Promise<ChatResponse>>()
  const budgeted = withBudget(chat, { maxUsd: opts.maxUsd ?? 1 })
  return {
    tracer,
    async answer(question: string, feature: string): Promise<AgentResult> {
      // Cache is the outermost layer: a hit makes no call, records no span and spends no budget
      const chatFn = withCache(instrument(budgeted, tracer, { feature }), cache)
      return runAgent(question, tools, { system: SUPPORT_SYSTEM, model: routeModel(question), chat: chatFn })
    },
    report: () => summarize(tracer.spans),
    spent: () => budgeted.spent(),
  }
}
