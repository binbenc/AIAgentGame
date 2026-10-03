import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, firstUserText, lastToolResults, say } from '../../../engine/llm/mock-kit'
import type { ChatRequest, ChatResponse, Message, Usage } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { __delay, chat } from '../../../engine/runtime/api'
import { basicNovaTools, createNova, REFUND_POLICY, type Tool } from '../../shared/nova'

type ChatFn = (req: ChatRequest) => Promise<ChatResponse>
type Span = { feature: string; model: string; latencyMs: number; inputTokens: number; outputTokens: number; costUsd: number; error?: string }
type Tracer = { spans: Span[]; record(s: Span): void }
type Stats = { calls: number; errors: number; inputTokens: number; outputTokens: number; costUsd: number; p50LatencyMs: number; p95LatencyMs: number }
type AgentResult = { output: string; steps: number; messages: Message[]; stopReason: string }
type Bot = { tracer: Tracer; answer(q: string, feature: string): Promise<AgentResult>; report(): Record<string, Stats>; spent(): number }
type Mod = {
  costOf(model: string, usage: Usage): number
  createTracer(): Tracer
  instrument(fn: ChatFn, tracer: Tracer, attrs: { feature: string }): ChatFn
  summarize(spans: Span[]): Record<string, Stats>
  stableKey(v: unknown): string
  withCache(fn: ChatFn, store?: Map<string, Promise<ChatResponse>>): ChatFn
  routeModel(q: string): string
  createSupportBot(tools: Tool[], opts?: { maxUsd?: number }): Bot
}
type AgentMod = { runAgent(task: string, tools: Tool[], opts?: { chat?: ChatFn }): Promise<AgentResult> }

/** 与 task.md 一致的价格表（美元 / 百万 token） */
const PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
}
const price = (model: string, u: Usage) => {
  const p = PRICES[model] ?? PRICES['mock-default']
  return (u.input_tokens * p.input + u.output_tokens * p.output) / 1e6
}
const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9
const fmt = (n: number) => `$${n.toFixed(6)}`

const FAQ = L('你们几点下班？', 'What time do you close?')
const ORDER_Q = L('我的邮箱是 alice@example.com，我最近发货的那单到哪了？', "My email is alice@example.com. Where's my most recently shipped order?")
const RETURN_Q = L('退货政策是什么？', "What's your return policy?")

function fakeChat(model: string, usage: Usage, ms: number): ChatFn {
  return async () => {
    await __delay(ms)
    return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage, model }
  }
}

/** trace 里所有成功调用的实际花费（按价格表） */
function traceCost(ctx: ScenarioCtx): number {
  return ctx.trace.llmCalls().reduce((n, c) => n + (c.response ? price(c.response.model, c.response.usage) : 0), 0)
}

export const suite: LevelSuite = {
  budgets: L({ calls: 15, tokens: 4700 }, { calls: 16, tokens: 5000 }),
  mock(req, ctx) {
    if (ctx.scenario === 'budget') return callTool(ctx, 'list_orders', { customer_id: 'C001' }, L('我再确认一下……', 'Let me double-check…'))
    const q = firstUserText(req)
    const used = allToolUses(req).map((t) => t.name)
    const last = lastToolResults(req)
    const parse = () => JSON.parse(last[0].content)
    if (/邮箱|email/i.test(q)) {
      if (!used.includes('find_customer')) return callTool(ctx, 'find_customer', { email: 'alice@example.com' })
      if (!used.includes('list_orders')) return callTool(ctx, 'list_orders', { customer_id: parse().id })
      if (!used.includes('get_shipping')) {
        const latest = [...parse()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).find((o) => o.status === 'shipped')
        return callTool(ctx, 'get_shipping', { order_id: latest.id })
      }
      const s = parse()
      return say(
        L(
          `您最近发货的订单 ${s.orderId} 由${s.carrier}承运，目前状态：${s.status}。`,
          `Your most recently shipped order ${s.orderId} is with ${s.carrier}. Current status: ${s.status}.`,
        ),
      )
    }
    if (/几点|下班|营业|what time|close|opening hours/i.test(q)) return say(L('Nova 客服在线时间是每天 9:00–21:00。', 'Nova support is online 9:00–21:00 every day.'))
    if (/退货|return/i.test(q)) return say(REFUND_POLICY)
    return say(L('您好，请问有什么可以帮您？', 'Hi, how can I help you?'))
  },
  scenarios: [
    {
      id: 'cost-unit',
      title: L('计费、埋点与汇总（单元测试）', 'Pricing, tracing and summaries (unit tests)'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        ctx.assert(near(m.costOf('mock-default', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 18), L('mock-default：输入 $3/MTok + 输出 $15/MTok，各 100 万 token 应为 $18', 'mock-default: $3/MTok input + $15/MTok output, so 1M tokens of each should cost $18'))
        ctx.assert(near(m.costOf('mock-fast', { input_tokens: 2000, output_tokens: 500 }), 0.0045), L('mock-fast：2000×$1/MTok + 500×$5/MTok 应为 $0.0045', 'mock-fast: 2000×$1/MTok + 500×$5/MTok should be $0.0045'))

        const tracer = m.createTracer()
        await m.instrument(fakeChat('mock-fast', { input_tokens: 2000, output_tokens: 500 }, 300), tracer, { feature: 'faq' })({ messages: [{ role: 'user', content: 'hi' }] })
        const s = tracer.spans[0]
        ctx.assert(s, L('instrument 每次调用都要往 tracer 里记一个 span', 'instrument should record a span in the tracer for every call'))
        ctx.eq(
          { feature: s.feature, model: s.model, latencyMs: s.latencyMs, inputTokens: s.inputTokens, outputTokens: s.outputTokens },
          { feature: 'faq', model: 'mock-fast', latencyMs: 300, inputTokens: 2000, outputTokens: 500 },
          L('span 字段不对（latencyMs 要用 agent-quest 的 now() 计时，model 用响应里的 model）', "Wrong span fields (time latencyMs with now() from agent-quest; take model from the response)"),
        )
        ctx.assert(near(s.costUsd, 0.0045), L(`span.costUsd 应为 $0.0045，实际 ${s.costUsd}`, `span.costUsd should be $0.0045, got ${s.costUsd}`))

        const boom: ChatFn = async () => {
          await __delay(100)
          throw new Error('503 overloaded_error')
        }
        let threw = false
        try {
          await m.instrument(boom, tracer, { feature: 'faq' })({ messages: [{ role: 'user', content: 'hi' }] })
        } catch {
          threw = true
        }
        ctx.assert(threw, L('instrument 不能吞掉错误：记录 span 之后要把错误继续抛出去', "instrument mustn't swallow errors: record the span, then re-throw"))
        ctx.includes(tracer.spans[1]?.error ?? '', '503', L('失败的调用也要记 span，并在 error 字段写上错误信息', 'Failed calls need a span too, with the error message in the error field'))
        ctx.eq(tracer.spans[1].latencyMs, 100, L('失败的 span 也要记录耗时', 'Failed spans should record latency too'))

        const mk = (feature: string, latencyMs: number, model = 'mock-fast'): Span => ({ feature, model, latencyMs, inputTokens: 100, outputTokens: 10, costUsd: 0.001 })
        const spans = [mk('faq', 400), mk('faq', 100), mk('faq', 1000), mk('faq', 300), mk('faq', 200), { ...mk('order', 900, 'mock-default'), error: 'x' }]
        const sum = m.summarize(spans)
        ctx.eq(
          { calls: sum.faq?.calls, errors: sum.faq?.errors, inputTokens: sum.faq?.inputTokens, outputTokens: sum.faq?.outputTokens },
          { calls: 5, errors: 0, inputTokens: 500, outputTokens: 50 },
          L('summarize 要按 feature 分组累加', 'summarize should group by feature and add up'),
        )
        ctx.assert(near(sum.faq.costUsd, 0.005), L('summarize 的 costUsd 应为该 feature 所有 span 之和', "summarize's costUsd should be the sum over all of that feature's spans"))
        ctx.eq([sum.faq.p50LatencyMs, sum.faq.p95LatencyMs], [300, 1000], L('延迟分位数用最近秩法：排序后取第 ceil(p/100 × n) 个', 'Latency percentiles use nearest-rank: sort, then take item number ceil(p/100 × n)'))
        ctx.eq([sum.order?.calls, sum.order?.errors], [1, 1], L('带 error 的 span 要计入 errors', 'Spans with an error should count toward errors'))
      },
    },
    {
      id: 'agent-di',
      title: L('runAgent 支持注入 chat', 'runAgent accepts an injected chat'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let n = 0
        const spy: ChatFn = (req) => {
          n++
          return chat(req)
        }
        const r = await runAgent(FAQ, [], { chat: spy })
        ctx.eq(n, 1, L('AgentOptions 要新增可选的 chat 字段：传了就用它调用模型（依赖注入）', 'Add an optional chat field to AgentOptions: when passed, use it to call the model (dependency injection)'))
        ctx.includes(r.output, '21:00', L('注入的 chat 返回的结果要正常使用', 'Use the result returned by the injected chat as usual'))
        const r2 = await runAgent(FAQ, [])
        ctx.includes(r2.output, '21:00', L('不传 chat 时要继续使用默认的 chat——之前所有关卡都依赖这个行为', 'Without chat, keep using the default chat — every earlier level depends on it'))
        ctx.eq(ctx.trace.llmCalls().length, 2, L('两次运行各调用一次模型', 'Each of the two runs should call the model once'))
      },
    },
    {
      id: 'attribution',
      title: L('按功能归因 + 模型路由', 'Per-feature attribution + model routing'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        for (const q of [FAQ, RETURN_Q, L('智能灯泡支持哪些 App？', 'Which apps work with the smart bulbs?')])
          ctx.eq(m.routeModel(q), 'fast', L(`“${q}”是简单 FAQ，应该路由到 fast`, `"${q}" is a simple FAQ and should be routed to fast`))
        for (const q of [ORDER_Q, L('帮我取消订单 NV-100002，然后看看退款什么时候到账', 'Cancel order NV-100002 for me, then check when the refund will arrive')])
          ctx.eq(m.routeModel(q), 'default', L(`“${q}”需要查数据、多步操作，应该路由到 default`, `"${q}" needs data lookups and multiple steps, so it should be routed to default`))

        const bot = m.createSupportBot(basicNovaTools(createNova()))
        await bot.answer(FAQ, 'faq')
        const r = await bot.answer(ORDER_Q, 'order-tracking')
        ctx.includes(r.output, L('已到达上海转运中心', 'Shanghai transit hub'), L('订单查询应正常完成', 'The order lookup should complete normally'))
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls[0].request.model, 'fast', L('FAQ 请求的 model 应为 fast——便宜的问题用便宜的模型', 'The FAQ request should use model fast — cheap questions get the cheap model'))
        ctx.assert(calls.slice(1).every((c) => (c.request.model ?? 'default') === 'default'), L('订单查询应使用 default 模型', 'The order lookup should use the default model'))

        const spans = bot.tracer.spans
        ctx.eq(spans.length, calls.length, L('每次模型调用都要对应一个 span（漏记的调用就是对不上账的钱）', "Every model call needs a matching span (a missed call is money that won't reconcile)"))
        spans.forEach((s, i) => {
          const res = calls[i].response!
          ctx.eq(
            [s.model, s.inputTokens, s.outputTokens, s.latencyMs],
            [res.model, res.usage.input_tokens, res.usage.output_tokens, calls[i].durationMs],
            L(`第 ${i + 1} 个 span 和实际调用对不上（model / token / 耗时）`, `Span #${i + 1} doesn't match the actual call (model / tokens / latency)`),
          )
          ctx.assert(
            near(s.costUsd, price(res.model, res.usage)),
            L(`第 ${i + 1} 个 span 的费用应为 ${fmt(price(res.model, res.usage))}，实际 ${s.costUsd}`, `Span #${i + 1} should cost ${fmt(price(res.model, res.usage))}, got ${s.costUsd}`),
          )
        })
        ctx.eq(
          spans.map((s) => s.feature),
          ['faq', 'order-tracking', 'order-tracking', 'order-tracking', 'order-tracking'],
          L('span 的 feature 要标记成调用 answer() 时传入的功能名', 'Each span\'s feature should be the feature name passed to answer()'),
        )
        const rep = bot.report()
        const total = ctx.trace.totalTokens()
        ctx.eq(
          (rep.faq?.inputTokens ?? 0) + (rep['order-tracking']?.inputTokens ?? 0) + (rep.faq?.outputTokens ?? 0) + (rep['order-tracking']?.outputTokens ?? 0),
          total.total,
          L('各功能的 token 合计应等于账单（trace）总量', 'Tokens summed across features should equal the bill (trace) total'),
        )
        ctx.assert(near((rep.faq?.costUsd ?? 0) + (rep['order-tracking']?.costUsd ?? 0), traceCost(ctx)), L('各功能的费用合计应等于实际总费用', 'Cost summed across features should equal the actual total cost'))
      },
    },
    {
      id: 'cache',
      title: L('响应缓存', 'Response cache'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        ctx.eq(
          m.stableKey({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } }),
          m.stableKey({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }),
          L('stableKey：对象键的顺序不同，key 应该相同', 'stableKey: objects with keys in a different order should get the same key'),
        )
        ctx.assert(m.stableKey([1, 2]) !== m.stableKey([2, 1]), L('stableKey：数组顺序有意义，不能排序', "stableKey: array order matters, don't sort arrays"))
        ctx.assert(m.stableKey({ a: 1 }) !== m.stableKey({ a: 2 }), L('stableKey：值不同，key 必须不同', 'stableKey: different values must give different keys'))

        let failures = 0
        const flaky = m.withCache(async () => {
          failures++
          throw new Error('503')
        })
        for (let i = 0; i < 2; i++) await flaky({ messages: [{ role: 'user', content: 'x' }] }).catch(() => {})
        ctx.eq(failures, 2, L('失败的结果不能被缓存，下次要重新调用', 'Failed results must not be cached; the next call should try again'))

        const bot = m.createSupportBot(basicNovaTools(createNova()))
        const a = await bot.answer(FAQ, 'faq')
        const b = await bot.answer(FAQ, 'faq')
        ctx.eq(ctx.trace.llmCalls().length, 1, L('同一个 FAQ 问两次，第二次应该命中缓存，不再调用模型', 'Asking the same FAQ twice should hit the cache the second time, with no model call'))
        ctx.eq(b.output, a.output, L('缓存命中时返回的回答应该和第一次一样', 'A cache hit should return the same answer as the first time'))
        await bot.answer(RETURN_Q, 'faq')
        ctx.eq(ctx.trace.llmCalls().length, 2, L('不同的问题不能命中缓存', 'A different question must not hit the cache'))
      },
    },
    {
      id: 'budget',
      title: L('预算守卫：拦住失控的循环', 'Budget guard: stop the runaway loop'),
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        const MAX = 0.009
        const bot = m.createSupportBot(basicNovaTools(createNova()), { maxUsd: MAX })
        let err: Error | undefined
        try {
          await bot.answer(L('帮我看看订单', 'Check my orders for me'), 'order-tracking')
        } catch (e) {
          err = e as Error
        }
        const spent = traceCost(ctx)
        if (!err)
          return ctx.fail(
            L(
              `Agent 一直在循环调用工具，共花了 ${fmt(spent)}，预算是 ${fmt(MAX)}——withBudget 应该在超预算前抛错`,
              `The agent kept looping on tool calls and spent ${fmt(spent)} against a ${fmt(MAX)} budget — withBudget should throw before going over budget`,
            ),
          )
        ctx.includes(err.message, L<string | RegExp>('预算', /budget/i), L('错误信息要写清楚是“预算”超限，方便 on-call 排查', 'The error message should say the "budget" was exceeded, so on-call can tell what happened'))
        ctx.assert(
          spent <= MAX,
          L(
            `实际花费 ${fmt(spent)} 超过了预算 ${fmt(MAX)}：要在调用**之前**预估（已花费 + 本次输入成本），而不是花完了才检查`,
            `Actual spend ${fmt(spent)} went over the ${fmt(MAX)} budget: estimate **before** the call (spent so far + this call's input cost) instead of checking after the money is gone`,
          ),
        )
        ctx.assert(near(bot.spent(), spent), L(`withBudget 统计的花费（${fmt(bot.spent())}）应等于实际花费（${fmt(spent)}）`, `The spend tracked by withBudget (${fmt(bot.spent())}) should equal the actual spend (${fmt(spent)})`))
      },
    },
  ],
}
