import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, lastToolResults, say } from '../../../engine/llm/mock-kit'
import { LLMError, type Message } from '../../../engine/llm/types'
import { __delay, __traced } from '../../../engine/runtime/api'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'

type AgentMod = {
  runAgent(task: string, tools: Tool[], opts?: { retries?: number; toolTimeoutMs?: number }): Promise<{ output: string; messages: Message[] }>
}
type ResMod = {
  withRetry<T>(fn: () => Promise<T>, o?: { retries?: number; baseDelayMs?: number }): Promise<T>
  withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T>
}

function tools(): Tool[] {
  const report: Tool = {
    spec: {
      name: 'generate_report',
      description: '生成月度销售报表。',
      input_schema: { type: 'object', properties: { month: { type: 'string', description: '月份，如 2026-09' } }, required: ['month'] },
    },
    run: __traced('generateReport', async () => {
      await __delay(60_000) // 报表服务卡死了
      return '报表已生成'
    }),
  }
  return [...basicNovaTools(createNova()), report]
}

function toolResults(messages: Message[]) {
  return messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result') as {
    content: string
    is_error?: boolean
  }[]
}

export const suite: LevelSuite = {
  budgets: { calls: 16, tokens: 3200 },
  mock(req, ctx) {
    const last = lastToolResults(req)
    switch (ctx.scenario) {
      case 'rate-limit':
        if (ctx.call < 2) throw new LLMError('429 rate_limit_error: 请求过于频繁', 429, true)
        return say('Nova 客服在线时间是 9:00–21:00。')
      case 'bad-request':
        throw new LLMError('400 invalid_request_error: messages.0.content 格式错误', 400, false)
      case 'exhausted':
        throw new LLMError('503 overloaded_error: 服务暂时不可用', 503, true)
      case 'hallucinated-tool':
        if (ctx.call === 0) return callTool(ctx, 'delete_all_orders', {}, '我先清理一下订单。')
        if (ctx.call === 1) {
          if (!last[0]?.is_error || !last[0].content.includes('get_shipping')) return say('好的，已经全部删除了。')
          return callTool(ctx, 'get_shipping', { order_id: 'NV-100001' })
        }
        return say(`查到了：${JSON.parse(last[0].content).status}`)
      case 'bad-args':
        if (ctx.call === 0) return callTool(ctx, 'get_shipping', '{"order_id": "NV-1000')
        if (ctx.call === 1) return callTool(ctx, 'get_shipping', {})
        if (ctx.call === 2) return callTool(ctx, 'get_shipping', { order_id: 'NV-100001' })
        return say(`订单 NV-100001：${JSON.parse(last[0].content).status}`)
      case 'slow-tool':
        if (ctx.call === 0) return callTool(ctx, 'generate_report', { month: '2026-09' })
        return say(last[0]?.is_error ? '报表服务暂时繁忙，生成好后会发到您的邮箱。' : '报表已生成。')
      default:
        return say('OK')
    }
  },
  scenarios: [
    {
      id: 'rate-limit',
      title: '限流：退避重试',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent('你们几点下班？', tools())
        ctx.includes(r.output, '21:00', '重试成功后应正常返回')
        ctx.eq(ctx.trace.llmCalls().length, 3, '前两次 429，第三次成功，一共调用 3 次')
        const sleeps = ctx.trace.events.filter((e) => e.kind === 'sleep').map((e) => (e as { ms: number }).ms)
        ctx.eq(sleeps.length, 2, '每次重试前都要用 sleep() 等待')
        ctx.assert(sleeps[0] >= 100, `第一次退避太短（${sleeps[0]}ms），至少 100ms`)
        ctx.assert(sleeps[1] > sleeps[0], `退避时间应该指数增长（${sleeps.join(' → ')}）`)
      },
    },
    {
      id: 'retry-unit',
      title: 'withRetry / withTimeout 单元测试',
      async run(ctx: ScenarioCtx) {
        const { withRetry, withTimeout } = ctx.load<ResMod>('resilience.ts')
        let n = 0
        const v = await withRetry(async () => {
          if (++n < 3) throw new LLMError('503', 503, true)
          return 'ok'
        }, { retries: 3, baseDelayMs: 200 })
        ctx.eq([v, n], ['ok', 3], 'withRetry 应在第 3 次成功')
        const sleeps = ctx.trace.events.filter((e) => e.kind === 'sleep').map((e) => (e as { ms: number }).ms)
        ctx.assert(sleeps[0] >= 200 && sleeps[0] < 400 && sleeps[1] >= 400 && sleeps[1] < 600, `退避应为 base×2^i + [0, base) 的抖动，实际：${sleeps.join(', ')}`)
        let msg = ''
        try {
          await withTimeout(__delay(5000).then(() => 'late'), 1000, '查询')
        } catch (e) {
          msg = (e as Error).message
        }
        ctx.includes(msg, '超时', 'withTimeout 超时后应抛出包含“超时”的错误')
        ctx.eq(await withTimeout(Promise.resolve(42), 1000), 42, '没超时时应返回原结果')
      },
    },
    {
      id: 'bad-request',
      title: '不可重试的错误',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let threw = false
        try {
          await runAgent('hi', tools())
        } catch {
          threw = true
        }
        ctx.assert(threw, '400 错误应该向上抛出')
        ctx.eq(ctx.trace.llmCalls().length, 1, '400 是不可重试的错误，不应该重试')
      },
    },
    {
      id: 'exhausted',
      title: '重试耗尽',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let threw = false
        try {
          await runAgent('hi', tools(), { retries: 2 })
        } catch {
          threw = true
        }
        ctx.assert(threw, '重试耗尽后应该抛出错误')
        ctx.eq(ctx.trace.llmCalls().length, 3, 'retries=2：首次调用 + 2 次重试 = 3 次')
      },
    },
    {
      id: 'hallucinated-tool',
      title: '幻觉工具',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent('NV-100001 到哪了？', tools())
        } catch (e) {
          return ctx.fail(`Agent 崩溃了：${(e as Error).message}`)
        }
        const first = toolResults(r.messages)[0]
        ctx.assert(first?.is_error, '调用不存在的工具时，应返回 is_error 的 tool_result')
        ctx.includes(first.content, 'get_shipping', '错误信息里应列出可用工具名，帮模型纠正')
        ctx.includes(r.output, '上海转运中心', '模型纠正后应得到正确答案')
      },
    },
    {
      id: 'bad-args',
      title: '坏参数',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent('NV-100001 到哪了？', tools())
        } catch (e) {
          return ctx.fail(`Agent 崩溃了：${(e as Error).message}`)
        }
        const results = toolResults(r.messages)
        ctx.assert(results[0]?.is_error && results[1]?.is_error, '非对象参数、缺少必填字段都应返回 is_error')
        ctx.includes(results[1].content, 'order_id', '缺字段时应说明缺了哪个字段')
        ctx.eq(ctx.trace.toolCalls('getShipping').length, 1, '参数不合法时不应执行工具；只有最后一次合法调用才执行')
        ctx.includes(r.output, '上海转运中心', '最终应得到正确答案')
      },
    },
    {
      id: 'slow-tool',
      title: '慢工具超时',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent('生成 9 月报表', tools(), { toolTimeoutMs: 5000 })
        ctx.assert(ctx.now() < 60_000, `Agent 等了 ${ctx.now()}ms——工具执行要有超时`)
        const res = toolResults(r.messages)[0]
        ctx.assert(res?.is_error, '工具超时应返回 is_error')
        ctx.includes(res.content, '超时', '错误信息里应说明是超时')
        ctx.includes(r.output, '邮箱', '模型拿到超时错误后应给出降级回复')
      },
    },
  ],
}
