import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, callTools, lastToolResults, say } from '../../../engine/llm/mock-kit'
import type { Message } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'

type AgentResult = { output: string; steps: number; messages: Message[]; stopReason: string }
type Mod = { runAgent(task: string | Message[], tools: Tool[], opts?: { system?: string; maxSteps?: number }): Promise<AgentResult> }

const SYSTEM = L('你是 Nova 科技客服 Agent。', 'You are the Nova Tech support agent.')

export const suite: LevelSuite = {
  budgets: L({ calls: 12, tokens: 4200 }, { calls: 12, tokens: 3760 }),
  mock(req, ctx) {
    const used = allToolUses(req).map((t) => t.name)
    const last = lastToolResults(req)
    const parse = (i = 0) => JSON.parse(last[i].content)
    switch (ctx.scenario) {
      case 'multi-step': {
        if (!used.includes('find_customer')) return callTool(ctx, 'find_customer', { email: 'alice@example.com' }, L('先查一下客户信息。', 'Let me look up the customer first.'))
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
      case 'parallel': {
        if (!used.length)
          return callTools(ctx, [
            { name: 'get_shipping', input: { order_id: 'NV-100001' } },
            { name: 'get_shipping', input: { order_id: 'NV-100004' } },
          ], L('两个订单我同时查。', "I'll check both orders at once."))
        const a = parse(0)
        const b = parse(1)
        return say(L(`${a.orderId}：${a.status}；${b.orderId}：${b.status}。`, `${a.orderId}: ${a.status}; ${b.orderId}: ${b.status}.`))
      }
      case 'runaway':
        return callTool(ctx, 'list_orders', { customer_id: 'C001' }, L('我再确认一下……', 'Let me double-check...'))
      default:
        return say(L('Nova 客服在线时间是每天 9:00–21:00。', 'Nova support is available every day from 9:00 to 21:00.'))
    }
  },
  scenarios: [
    {
      id: 'multi-step',
      title: L('多步推理', 'Multi-step reasoning'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const nova = createNova()
        const r = await runAgent(
          L('我的邮箱是 alice@example.com，我最近发货的那单到哪了？', "My email is alice@example.com. Where's my most recently shipped order?"),
          basicNovaTools(nova),
          { system: SYSTEM },
        )
        ctx.eq(r.stopReason, 'done', L('应该正常结束', 'The run should finish normally'))
        ctx.includes(r.output, L('已到达上海转运中心', 'Shanghai transit hub'), L('最终回答应包含物流状态', 'The final answer should include the shipping status'))
        ctx.eq(r.steps, 4, L('应该经过 4 步：查客户 → 列订单 → 查物流 → 回答', 'Expected 4 steps: find customer → list orders → check shipping → answer'))
        ctx.eq(ctx.trace.toolCalls().map((c) => c.name), ['findCustomer', 'listOrders', 'getShipping'], L('工具执行顺序不对', 'Tools ran in the wrong order'))
        const req = ctx.trace.llmCalls()[3].request
        ctx.eq(req.system, SYSTEM, L('每一步都要带上 system', 'Send system on every step'))
        ctx.eq(req.tools?.length, 3, L('每一步都要带上 tools', 'Send tools on every step'))
        ctx.eq(r.messages.length, 8, L('messages 应包含完整对话：1 条任务 + 3×(assistant+tool_result) + 最终回答', 'messages should hold the whole conversation: 1 task + 3×(assistant + tool_result) + the final answer'))
      },
    },
    {
      id: 'parallel',
      title: L('并行工具调用', 'Parallel tool calls'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent(
          L('帮我同时查一下 NV-100001 和 NV-100004 的物流', 'Check the shipping for NV-100001 and NV-100004 at the same time, please'),
          basicNovaTools(createNova()),
        )
        ctx.includes(r.output, L('派送中', 'Out for delivery'), L('两个订单的结果都要交给模型', "Both orders' results must be given to the model"))
        ctx.eq(ctx.trace.toolCalls('getShipping').length, 2, L('两个工具调用都要执行', 'Both tool calls must run'))
        const second = ctx.trace.llmCalls()[1].request
        const lastMsg = second.messages[second.messages.length - 1]
        ctx.assert(Array.isArray(lastMsg.content) && lastMsg.content.length === 2, L('两个 tool_result 应放在同一条 user 消息里', 'Both tool_results belong in one user message'))
        const [a, b] = ctx.trace.toolCalls('getShipping')
        ctx.eq(a.t, b.t, L('两个工具应该并行执行（Promise.all），而不是一个接一个', 'The two tools should run in parallel (Promise.all), not one after the other'))
      },
    },
    {
      id: 'runaway',
      title: L('失控保护', 'Runaway protection'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent(L('帮我看看订单', 'Can you check my orders?'), basicNovaTools(createNova()), { maxSteps: 5 })
        ctx.eq(r.stopReason, 'max_steps', L('超过最大步数应返回 stopReason: "max_steps"', 'Past the step limit, return stopReason: "max_steps"'))
        ctx.eq(ctx.trace.llmCalls().length, 5, L('maxSteps=5 时最多调用模型 5 次', 'With maxSteps=5, call the model at most 5 times'))
      },
    },
    {
      id: 'direct',
      title: L('直接回答', 'Direct answer'),
      async run(ctx: ScenarioCtx) {
        const { runAgent } = ctx.load<Mod>('agent.ts')
        const r = await runAgent(L('你们几点下班？', 'What time do you close?'), basicNovaTools(createNova()))
        ctx.eq(r.steps, 1, L('不需要工具时一步结束', 'Finish in one step when no tool is needed'))
        ctx.includes(r.output, '21:00', L('返回模型的回答', "Return the model's answer"))
      },
    },
  ],
}
