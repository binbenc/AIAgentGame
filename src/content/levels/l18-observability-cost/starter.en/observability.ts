import { chat, countTokens, now, type ChatRequest, type ChatResponse, type ModelTier, type Usage } from 'agent-quest'
import { runAgent, type AgentResult } from './agent'
import type { Tool } from './tools'

export type ChatFn = (req: ChatRequest) => Promise<ChatResponse>

/** Price table: USD per million tokens (MTok), billed by the model in the response */
export const PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
}

export function costOf(model: string, usage: Usage): number {
  // TODO: (input tokens × input price + output tokens × output price) / 1_000_000
  //       model may also be a tier name 'default' / 'fast'; price unknown models as mock-default (better to overestimate)
  return 0
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

/** Instrument a chat function: record one span per call */
export function instrument(chatFn: ChatFn, tracer: Tracer, attrs: { feature: string }): ChatFn {
  // TODO: time the call with now() before and after; on success record a span from the response's model / usage (including costUsd)
  //       on failure also record a span with error (0 tokens, 0 cost), then re-throw the error
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

/** Summarize by feature: calls, errors, tokens, cost, latency percentiles (nearest-rank) */
export function summarize(spans: Span[]): Record<string, FeatureStats> {
  // TODO: group by span.feature and add up; percentile = item number ceil(p/100 × n) after sorting ascending (counting from 1)
  return {}
}

// ------------------------------------------------------------------ Caching

/** Stable serialization: sort object keys before output so {a,b} and {b,a} get the same key */
export function stableKey(value: unknown): string {
  // TODO: recurse into arrays (keep order) and objects (sort keys, skip undefined)
  return JSON.stringify(value)
}

/** Response cache: an identical request gets the previous result back */
export function withCache(chatFn: ChatFn, store: Map<string, Promise<ChatResponse>> = new Map()): ChatFn {
  // TODO: key = stableKey(req); on a hit return the cached response (ideally a structuredClone); don't cache failures
  void store
  return chatFn
}

// ------------------------------------------------------------------ Routing

/** Model routing: simple FAQs go to 'fast'; order lookups and multi-step tasks go to 'default' */
export function routeModel(question: string): ModelTier {
  // TODO: decide with zero-cost rules (length, order ids, emails, keywords like "help me / cancel / refund / then"...)
  return 'default'
}

// ------------------------------------------------------------------ Budget

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** Budget guard: refuse any call that would go over budget */
export function withBudget(chatFn: ChatFn, opts: { maxUsd: number }): ChatFn & { spent(): number } {
  let spent = 0
  const fn = async (req: ChatRequest) => {
    // TODO: estimate before calling: spent so far + this call's input cost (countTokens(req) input tokens at the req.model tier's price)
    //       if it exceeds opts.maxUsd, throw new BudgetExceededError('Budget exceeded: ...')
    //       after the call, add the actual cost to spent
    void countTokens
    return chatFn(req)
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
      // TODO: compose withCache(instrument(budgeted, tracer, { feature }), cache),
      //       pick the model with routeModel, and inject it through runAgent's opts.chat (update agent.ts first)
      void cache
      return runAgent(question, tools, { system: SUPPORT_SYSTEM })
    },
    report: () => summarize(tracer.spans),
    spent: () => budgeted.spent(),
  }
}
