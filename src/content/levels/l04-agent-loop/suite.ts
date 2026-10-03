import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, callTools, lastToolResults, say } from '../../../engine/llm/mock-kit'
import type { Message } from '../../../engine/llm/types'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'

type AgentResult = { output: string; steps: number; messages: Message[]; stopReason: string }
type Mod = { runAgent(task: string | Message[], tools: Tool[], opts?: { system?: string; maxSteps?: number }): Promise<AgentResult> }

const SYSTEM = '你是 Nova 科技客服 Agent。'

export const suite: LevelSuite = {
  budgets: { calls: 12, tokens: 4200 },
  mock(req, ctx) {
    const used = allToolUses(req).map((t) => t.name)
    const last = lastToolResults(req)
    const parse = (i = 0) => JSON.parse(last[i].content)
    switch (ctx.scenario) {
      case 'multi-step': {
        if (!used.includes('find_customer')) return callTool(ctx, 'find_customer', { email: 'alice@example.com' }, '先查一下客户信息。')
        if (!used.includes('list_orders')) return callTool(ctx, 'list_orders', { customer_id: parse().id })
        if (!used.includes('get_shipping')) {
          const latest = [...parse()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).find((o) => o.status === 'shipped')
          return callTool(ctx, 'get_shipping', { order_id: latest.id })
        }
        const s = parse()
        return say(`您最近发货的订单 ${s.orderId} 由${s.carrier}承运，目前状态：${s.status}。`)
      }
      case 'parallel': {
        if (!used.length)
          return callTools(ctx, [
            { name: 'get_shipping', input: { order_id: 'NV-100001' } },
            { name: 'get_shipping', input: { order_id: 'NV-100004' } },
          ], '两个订单我同时查。')
        const a = parse(0)
        const b = parse(1)
        return say(`${a.orderId}：${a.status}；${b.orderId}：${b.status}。`)
      }
      case 'runaway':
        return callTool(ctx, 'list_orders', { customer_id: 'C001' }, '我再确认一下……')
      default:
        return say('Nova 客服在线时间是每天 9:00–21:00。')
    }
  },
  scenarios: [
    {
      id: 'multi-step',
      title: '多步推理',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const nova = createNova()
        const r = await runAgent('我的邮箱是 alice@example.com，我最近发货的那单到哪了？', basicNovaTools(nova), { system: SYSTEM })
        ctx.eq(r.stopReason, 'done', '应该正常结束')
        ctx.includes(r.output, '已到达上海转运中心', '最终回答应包含物流状态')
        ctx.eq(r.steps, 4, '应该经过 4 步：查客户 → 列订单 → 查物流 → 回答')
        ctx.eq(ctx.trace.toolCalls().map((c) => c.name), ['findCustomer', 'listOrders', 'getShipping'], '工具执行顺序不对')
        const req = ctx.trace.llmCalls()[3].request
        ctx.eq(req.system, SYSTEM, '每一步都要带上 system')
        ctx.eq(req.tools?.length, 3, '每一步都要带上 tools')
        ctx.eq(r.messages.length, 8, 'messages 应包含完整对话：1 条任务 + 3×(assistant+tool_result) + 最终回答')
      },
    },
    {
      id: 'parallel',
      title: '并行工具调用',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent('帮我同时查一下 NV-100001 和 NV-100004 的物流', basicNovaTools(createNova()))
        ctx.includes(r.output, '派送中', '两个订单的结果都要交给模型')
        ctx.eq(ctx.trace.toolCalls('getShipping').length, 2, '两个工具调用都要执行')
        const second = ctx.trace.llmCalls()[1].request
        const lastMsg = second.messages[second.messages.length - 1]
        ctx.assert(Array.isArray(lastMsg.content) && lastMsg.content.length === 2, '两个 tool_result 应放在同一条 user 消息里')
        const [a, b] = ctx.trace.toolCalls('getShipping')
        ctx.eq(a.t, b.t, '两个工具应该并行执行（Promise.all），而不是一个接一个')
      },
    },
    {
      id: 'runaway',
      title: '失控保护',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent('帮我看看订单', basicNovaTools(createNova()), { maxSteps: 5 })
        ctx.eq(r.stopReason, 'max_steps', '超过最大步数应返回 stopReason: "max_steps"')
        ctx.eq(ctx.trace.llmCalls().length, 5, 'maxSteps=5 时最多调用模型 5 次')
      },
    },
    {
      id: 'direct',
      title: '直接回答',
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent('你们几点下班？', basicNovaTools(createNova()))
        ctx.eq(r.steps, 1, '不需要工具时一步结束')
        ctx.includes(r.output, '21:00', '返回模型的回答')
      },
    },
  ],
}
