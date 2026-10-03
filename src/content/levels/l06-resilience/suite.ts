import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, lastToolResults, say } from '../../../engine/llm/mock-kit'
import { LLMError, type Message } from '../../../engine/llm/types'
import { __delay, __traced } from '../../../engine/runtime/api'
import { L } from '../../../engine/locale'
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
      description: L('生成月度销售报表。', 'Generate the monthly sales report.'),
      input_schema: { type: 'object', properties: { month: { type: 'string', description: L('月份，如 2026-09', 'Month, e.g. 2026-09') } }, required: ['month'] },
    },
    run: __traced('generateReport', async () => {
      await __delay(60_000) // 报表服务卡死了
      return L('报表已生成', 'Report generated')
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
  budgets: L({ calls: 16, tokens: 3200 }, { calls: 16, tokens: 2850 }),
  mock(req, ctx) {
    const last = lastToolResults(req)
    switch (ctx.scenario) {
      case 'rate-limit':
        if (ctx.call < 2) throw new LLMError(L('429 rate_limit_error: 请求过于频繁', '429 rate_limit_error: too many requests'), 429, true)
        return say(L('Nova 客服在线时间是 9:00–21:00。', 'Nova support is online from 9:00 to 21:00.'))
      case 'bad-request':
        throw new LLMError(L('400 invalid_request_error: messages.0.content 格式错误', '400 invalid_request_error: messages.0.content is malformed'), 400, false)
      case 'exhausted':
        throw new LLMError(L('503 overloaded_error: 服务暂时不可用', '503 overloaded_error: service temporarily unavailable'), 503, true)
      case 'hallucinated-tool':
        if (ctx.call === 0) return callTool(ctx, 'delete_all_orders', {}, L('我先清理一下订单。', 'Let me clean up the orders first.'))
        if (ctx.call === 1) {
          if (!last[0]?.is_error || !last[0].content.includes('get_shipping')) return say(L('好的，已经全部删除了。', 'Done, I deleted all of them.'))
          return callTool(ctx, 'get_shipping', { order_id: 'NV-100001' })
        }
        return say(L(`查到了：${JSON.parse(last[0].content).status}`, `Found it: ${JSON.parse(last[0].content).status}`))
      case 'bad-args':
        if (ctx.call === 0) return callTool(ctx, 'get_shipping', '{"order_id": "NV-1000')
        if (ctx.call === 1) return callTool(ctx, 'get_shipping', {})
        if (ctx.call === 2) return callTool(ctx, 'get_shipping', { order_id: 'NV-100001' })
        return say(L(`订单 NV-100001：${JSON.parse(last[0].content).status}`, `Order NV-100001: ${JSON.parse(last[0].content).status}`))
      case 'slow-tool':
        if (ctx.call === 0) return callTool(ctx, 'generate_report', { month: '2026-09' })
        return say(
          last[0]?.is_error
            ? L('报表服务暂时繁忙，生成好后会发到您的邮箱。', "The report service is busy right now. We'll send the report to your email once it's ready.")
            : L('报表已生成。', 'The report is ready.'),
        )
      default:
        return say('OK')
    }
  },
  scenarios: [
    {
      id: 'rate-limit',
      title: L('限流：退避重试', 'Rate limit: back off and retry'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent(L('你们几点下班？', 'What time do you close?'), tools())
        ctx.includes(r.output, '21:00', L('重试成功后应正常返回', 'After a successful retry, the agent should return normally'))
        ctx.eq(ctx.trace.llmCalls().length, 3, L('前两次 429，第三次成功，一共调用 3 次', 'Two 429s, then success on the third try: 3 calls in total'))
        const sleeps = ctx.trace.events.filter((e) => e.kind === 'sleep').map((e) => (e as { ms: number }).ms)
        ctx.eq(sleeps.length, 2, L('每次重试前都要用 sleep() 等待', 'Wait with sleep() before every retry'))
        ctx.assert(sleeps[0] >= 100, L(`第一次退避太短（${sleeps[0]}ms），至少 100ms`, `The first backoff is too short (${sleeps[0]}ms); it should be at least 100ms`))
        ctx.assert(sleeps[1] > sleeps[0], L(`退避时间应该指数增长（${sleeps.join(' → ')}）`, `Backoff should grow exponentially (${sleeps.join(' → ')})`))
      },
    },
    {
      id: 'retry-unit',
      title: L('withRetry / withTimeout 单元测试', 'withRetry / withTimeout unit tests'),
      async run(ctx: ScenarioCtx) {
        const { withRetry, withTimeout } = ctx.load<ResMod>('resilience.ts')
        let n = 0
        const v = await withRetry(async () => {
          if (++n < 3) throw new LLMError('503', 503, true)
          return 'ok'
        }, { retries: 3, baseDelayMs: 200 })
        ctx.eq([v, n], ['ok', 3], L('withRetry 应在第 3 次成功', 'withRetry should succeed on the 3rd attempt'))
        const sleeps = ctx.trace.events.filter((e) => e.kind === 'sleep').map((e) => (e as { ms: number }).ms)
        ctx.assert(sleeps[0] >= 200 && sleeps[0] <= 400 && sleeps[1] >= 400 && sleeps[1] <= 600, L(`退避应为 base×2^i + [0, base) 的抖动，实际：${sleeps.join(', ')}`, `Backoff should be base×2^i + jitter in [0, base); got: ${sleeps.join(', ')}`))
        let msg = ''
        try {
          await withTimeout(__delay(5000).then(() => 'late'), 1000, L('查询', 'Query'))
        } catch (e) {
          msg = (e as Error).message
        }
        ctx.includes(msg, L('超时', 'timed out'), L('withTimeout 超时后应抛出包含“超时”的错误', 'On timeout, withTimeout should throw an error whose message contains "timed out"'))
        ctx.eq(await withTimeout(Promise.resolve(42), 1000), 42, L('没超时时应返回原结果', 'Without a timeout, it should return the original result'))
      },
    },
    {
      id: 'bad-request',
      title: L('不可重试的错误', 'Non-retryable error'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let threw = false
        try {
          await runAgent('hi', tools())
        } catch {
          threw = true
        }
        ctx.assert(threw, L('400 错误应该向上抛出', 'A 400 error should be thrown to the caller'))
        ctx.eq(ctx.trace.llmCalls().length, 1, L('400 是不可重试的错误，不应该重试', "400 is not retryable; don't retry it"))
      },
    },
    {
      id: 'exhausted',
      title: L('重试耗尽', 'Retries exhausted'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let threw = false
        try {
          await runAgent('hi', tools(), { retries: 2 })
        } catch {
          threw = true
        }
        ctx.assert(threw, L('重试耗尽后应该抛出错误', 'Once retries run out, throw the error'))
        ctx.eq(ctx.trace.llmCalls().length, 3, L('retries=2：首次调用 + 2 次重试 = 3 次', 'retries=2: first call + 2 retries = 3 calls'))
      },
    },
    {
      id: 'hallucinated-tool',
      title: L('幻觉工具', 'Hallucinated tool'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent(L('NV-100001 到哪了？', 'Where is NV-100001?'), tools())
        } catch (e) {
          return ctx.fail(L(`Agent 崩溃了：${(e as Error).message}`, `The agent crashed: ${(e as Error).message}`))
        }
        const first = toolResults(r.messages)[0]
        ctx.assert(first?.is_error, L('调用不存在的工具时，应返回 is_error 的 tool_result', 'Calling a tool that does not exist should produce an is_error tool_result'))
        ctx.includes(first.content, 'get_shipping', L('错误信息里应列出可用工具名，帮模型纠正', 'The error should list the available tool names so the model can correct itself'))
        ctx.includes(r.output, L('上海转运中心', 'Shanghai transit hub'), L('模型纠正后应得到正确答案', 'After correcting itself, the model should reach the right answer'))
      },
    },
    {
      id: 'bad-args',
      title: L('坏参数', 'Bad arguments'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent(L('NV-100001 到哪了？', 'Where is NV-100001?'), tools())
        } catch (e) {
          return ctx.fail(L(`Agent 崩溃了：${(e as Error).message}`, `The agent crashed: ${(e as Error).message}`))
        }
        const results = toolResults(r.messages)
        ctx.assert(results[0]?.is_error && results[1]?.is_error, L('非对象参数、缺少必填字段都应返回 is_error', 'Non-object arguments and missing required fields should both produce is_error'))
        ctx.includes(results[1].content, 'order_id', L('缺字段时应说明缺了哪个字段', 'When a field is missing, say which one'))
        ctx.eq(ctx.trace.toolCalls('getShipping').length, 1, L('参数不合法时不应执行工具；只有最后一次合法调用才执行', "Don't run the tool when the arguments are invalid; only the final valid call should run"))
        ctx.includes(r.output, L('上海转运中心', 'Shanghai transit hub'), L('最终应得到正确答案', 'The agent should end up with the right answer'))
      },
    },
    {
      id: 'slow-tool',
      title: L('慢工具超时', 'Slow tool timeout'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent(L('生成 9 月报表', 'Generate the September report'), tools(), { toolTimeoutMs: 5000 })
        ctx.assert(ctx.now() < 60_000, L(`Agent 等了 ${ctx.now()}ms——工具执行要有超时`, `The agent waited ${ctx.now()}ms. Tool execution needs a timeout`))
        const res = toolResults(r.messages)[0]
        ctx.assert(res?.is_error, L('工具超时应返回 is_error', 'A tool timeout should produce is_error'))
        ctx.includes(res.content, L('超时', 'timed out'), L('错误信息里应说明是超时', 'The error should say it timed out'))
        ctx.includes(r.output, L('邮箱', 'email'), L('模型拿到超时错误后应给出降级回复', 'Given the timeout error, the model should fall back to a degraded reply'))
      },
    },
  ],
}
