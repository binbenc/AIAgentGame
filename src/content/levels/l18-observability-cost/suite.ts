import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, firstUserText, lastToolResults, say } from '../../../engine/llm/mock-kit'
import type { ChatRequest, ChatResponse, Message, Usage } from '../../../engine/llm/types'
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

const FAQ = '你们几点下班？'
const ORDER_Q = '我的邮箱是 alice@example.com，我最近发货的那单到哪了？'

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
  budgets: { calls: 15, tokens: 4700 },
  mock(req, ctx) {
    if (ctx.scenario === 'budget') return callTool(ctx, 'list_orders', { customer_id: 'C001' }, '我再确认一下……')
    const q = firstUserText(req)
    const used = allToolUses(req).map((t) => t.name)
    const last = lastToolResults(req)
    const parse = () => JSON.parse(last[0].content)
    if (/邮箱/.test(q)) {
      if (!used.includes('find_customer')) return callTool(ctx, 'find_customer', { email: 'alice@example.com' })
      if (!used.includes('list_orders')) return callTool(ctx, 'list_orders', { customer_id: parse().id })
      if (!used.includes('get_shipping')) {
        const latest = [...parse()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).find((o) => o.status === 'shipped')
        return callTool(ctx, 'get_shipping', { order_id: latest.id })
      }
      const s = parse()
      return say(`您最近发货的订单 ${s.orderId} 由${s.carrier}承运，目前状态：${s.status}。`)
    }
    if (/几点|下班|营业/.test(q)) return say('Nova 客服在线时间是每天 9:00–21:00。')
    if (/退货/.test(q)) return say(REFUND_POLICY)
    return say('您好，请问有什么可以帮您？')
  },
  scenarios: [
    {
      id: 'cost-unit',
      title: '计费、埋点与汇总（单元测试）',
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        ctx.assert(near(m.costOf('mock-default', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 18), 'mock-default：输入 $3/MTok + 输出 $15/MTok，各 100 万 token 应为 $18')
        ctx.assert(near(m.costOf('mock-fast', { input_tokens: 2000, output_tokens: 500 }), 0.0045), 'mock-fast：2000×$1/MTok + 500×$5/MTok 应为 $0.0045')

        const tracer = m.createTracer()
        await m.instrument(fakeChat('mock-fast', { input_tokens: 2000, output_tokens: 500 }, 300), tracer, { feature: 'faq' })({ messages: [{ role: 'user', content: 'hi' }] })
        const s = tracer.spans[0]
        ctx.assert(s, 'instrument 每次调用都要往 tracer 里记一个 span')
        ctx.eq(
          { feature: s.feature, model: s.model, latencyMs: s.latencyMs, inputTokens: s.inputTokens, outputTokens: s.outputTokens },
          { feature: 'faq', model: 'mock-fast', latencyMs: 300, inputTokens: 2000, outputTokens: 500 },
          'span 字段不对（latencyMs 要用 agent-quest 的 now() 计时，model 用响应里的 model）',
        )
        ctx.assert(near(s.costUsd, 0.0045), `span.costUsd 应为 $0.0045，实际 ${s.costUsd}`)

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
        ctx.assert(threw, 'instrument 不能吞掉错误：记录 span 之后要把错误继续抛出去')
        ctx.includes(tracer.spans[1]?.error ?? '', '503', '失败的调用也要记 span，并在 error 字段写上错误信息')
        ctx.eq(tracer.spans[1].latencyMs, 100, '失败的 span 也要记录耗时')

        const mk = (feature: string, latencyMs: number, model = 'mock-fast'): Span => ({ feature, model, latencyMs, inputTokens: 100, outputTokens: 10, costUsd: 0.001 })
        const spans = [mk('faq', 400), mk('faq', 100), mk('faq', 1000), mk('faq', 300), mk('faq', 200), { ...mk('order', 900, 'mock-default'), error: 'x' }]
        const sum = m.summarize(spans)
        ctx.eq(
          { calls: sum.faq?.calls, errors: sum.faq?.errors, inputTokens: sum.faq?.inputTokens, outputTokens: sum.faq?.outputTokens },
          { calls: 5, errors: 0, inputTokens: 500, outputTokens: 50 },
          'summarize 要按 feature 分组累加',
        )
        ctx.assert(near(sum.faq.costUsd, 0.005), 'summarize 的 costUsd 应为该 feature 所有 span 之和')
        ctx.eq([sum.faq.p50LatencyMs, sum.faq.p95LatencyMs], [300, 1000], '延迟分位数用最近秩法：排序后取第 ceil(p/100 × n) 个')
        ctx.eq([sum.order?.calls, sum.order?.errors], [1, 1], '带 error 的 span 要计入 errors')
      },
    },
    {
      id: 'agent-di',
      title: 'runAgent 支持注入 chat',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let n = 0
        const spy: ChatFn = (req) => {
          n++
          return chat(req)
        }
        const r = await runAgent(FAQ, [], { chat: spy })
        ctx.eq(n, 1, 'AgentOptions 要新增可选的 chat 字段：传了就用它调用模型（依赖注入）')
        ctx.includes(r.output, '21:00', '注入的 chat 返回的结果要正常使用')
        const r2 = await runAgent(FAQ, [])
        ctx.includes(r2.output, '21:00', '不传 chat 时要继续使用默认的 chat——之前所有关卡都依赖这个行为')
        ctx.eq(ctx.trace.llmCalls().length, 2, '两次运行各调用一次模型')
      },
    },
    {
      id: 'attribution',
      title: '按功能归因 + 模型路由',
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        for (const q of [FAQ, '退货政策是什么？', '智能灯泡支持哪些 App？'])
          ctx.eq(m.routeModel(q), 'fast', `“${q}”是简单 FAQ，应该路由到 fast`)
        for (const q of [ORDER_Q, '帮我取消订单 NV-100002，然后看看退款什么时候到账'])
          ctx.eq(m.routeModel(q), 'default', `“${q}”需要查数据、多步操作，应该路由到 default`)

        const bot = m.createSupportBot(basicNovaTools(createNova()))
        await bot.answer(FAQ, 'faq')
        const r = await bot.answer(ORDER_Q, 'order-tracking')
        ctx.includes(r.output, '已到达上海转运中心', '订单查询应正常完成')
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls[0].request.model, 'fast', 'FAQ 请求的 model 应为 fast——便宜的问题用便宜的模型')
        ctx.assert(calls.slice(1).every((c) => (c.request.model ?? 'default') === 'default'), '订单查询应使用 default 模型')

        const spans = bot.tracer.spans
        ctx.eq(spans.length, calls.length, '每次模型调用都要对应一个 span（漏记的调用就是对不上账的钱）')
        spans.forEach((s, i) => {
          const res = calls[i].response!
          ctx.eq(
            [s.model, s.inputTokens, s.outputTokens, s.latencyMs],
            [res.model, res.usage.input_tokens, res.usage.output_tokens, calls[i].durationMs],
            `第 ${i + 1} 个 span 和实际调用对不上（model / token / 耗时）`,
          )
          ctx.assert(near(s.costUsd, price(res.model, res.usage)), `第 ${i + 1} 个 span 的费用应为 ${fmt(price(res.model, res.usage))}，实际 ${s.costUsd}`)
        })
        ctx.eq(
          spans.map((s) => s.feature),
          ['faq', 'order-tracking', 'order-tracking', 'order-tracking', 'order-tracking'],
          'span 的 feature 要标记成调用 answer() 时传入的功能名',
        )
        const rep = bot.report()
        const total = ctx.trace.totalTokens()
        ctx.eq(
          (rep.faq?.inputTokens ?? 0) + (rep['order-tracking']?.inputTokens ?? 0) + (rep.faq?.outputTokens ?? 0) + (rep['order-tracking']?.outputTokens ?? 0),
          total.total,
          '各功能的 token 合计应等于账单（trace）总量',
        )
        ctx.assert(near((rep.faq?.costUsd ?? 0) + (rep['order-tracking']?.costUsd ?? 0), traceCost(ctx)), '各功能的费用合计应等于实际总费用')
      },
    },
    {
      id: 'cache',
      title: '响应缓存',
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        ctx.eq(
          m.stableKey({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } }),
          m.stableKey({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }),
          'stableKey：对象键的顺序不同，key 应该相同',
        )
        ctx.assert(m.stableKey([1, 2]) !== m.stableKey([2, 1]), 'stableKey：数组顺序有意义，不能排序')
        ctx.assert(m.stableKey({ a: 1 }) !== m.stableKey({ a: 2 }), 'stableKey：值不同，key 必须不同')

        let failures = 0
        const flaky = m.withCache(async () => {
          failures++
          throw new Error('503')
        })
        for (let i = 0; i < 2; i++) await flaky({ messages: [{ role: 'user', content: 'x' }] }).catch(() => {})
        ctx.eq(failures, 2, '失败的结果不能被缓存，下次要重新调用')

        const bot = m.createSupportBot(basicNovaTools(createNova()))
        const a = await bot.answer(FAQ, 'faq')
        const b = await bot.answer(FAQ, 'faq')
        ctx.eq(ctx.trace.llmCalls().length, 1, '同一个 FAQ 问两次，第二次应该命中缓存，不再调用模型')
        ctx.eq(b.output, a.output, '缓存命中时返回的回答应该和第一次一样')
        await bot.answer('退货政策是什么？', 'faq')
        ctx.eq(ctx.trace.llmCalls().length, 2, '不同的问题不能命中缓存')
      },
    },
    {
      id: 'budget',
      title: '预算守卫：拦住失控的循环',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('observability.ts')
        const MAX = 0.009
        const bot = m.createSupportBot(basicNovaTools(createNova()), { maxUsd: MAX })
        let err: Error | undefined
        try {
          await bot.answer('帮我看看订单', 'order-tracking')
        } catch (e) {
          err = e as Error
        }
        const spent = traceCost(ctx)
        if (!err) return ctx.fail(`Agent 一直在循环调用工具，共花了 ${fmt(spent)}，预算是 ${fmt(MAX)}——withBudget 应该在超预算前抛错`)
        ctx.includes(err.message, '预算', '错误信息要写清楚是“预算”超限，方便 on-call 排查')
        ctx.assert(spent <= MAX, `实际花费 ${fmt(spent)} 超过了预算 ${fmt(MAX)}：要在调用**之前**预估（已花费 + 本次输入成本），而不是花完了才检查`)
        ctx.assert(near(bot.spent(), spent), `withBudget 统计的花费（${fmt(bot.spent())}）应等于实际花费（${fmt(spent)}）`)
      },
    },
  ],
}
