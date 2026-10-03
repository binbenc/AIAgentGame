import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import type { MockContext, MockReply } from '../../../engine/llm/providers/mock'
import { allToolUses, callTool, firstUserText, lastToolResults, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'
import { createNova, type NovaApi, type Tool } from '../../shared/nova'

type Plan = { steps: { id: number; task: string }[] }
type StepResult = { id: number; task: string; ok: boolean; output: string }
type Mod = { planAndExecute(goal: string, tools: Tool[], opts?: object): Promise<{ plan: Plan; stepResults: StepResult[]; output: string }> }

/** 执行者可用的工具（第 5 关风格的精简工具） */
function orderTools(nova: NovaApi): Tool[] {
  return [
    {
      spec: {
        name: 'search_orders',
        description: '按客户邮箱查询订单，可按状态过滤（pending=待发货，shipped=已发货，delivered=已签收，cancelled=已取消）。',
        input_schema: {
          type: 'object',
          properties: {
            customer_email: { type: 'string', description: '客户邮箱' },
            status: { type: 'string', enum: ['pending', 'shipped', 'delivered', 'cancelled'], description: '可选，订单状态' },
          },
          required: ['customer_email'],
        },
      },
      run: async (i) =>
        (await nova.searchOrders({ customerEmail: i.customer_email, status: i.status })).map(({ id, product, amount, status }) => ({ id, product, amount, status })),
    },
    {
      spec: {
        name: 'cancel_order',
        description: '取消一个尚未发货的订单；已发货的订单无法取消。',
        input_schema: {
          type: 'object',
          properties: { order_id: { type: 'string', description: '订单号，例如 NV-100001' }, reason: { type: 'string', description: '取消原因' } },
          required: ['order_id', 'reason'],
        },
      },
      run: (i) => nova.cancelOrder(i.order_id, i.reason),
    },
    {
      spec: { name: 'get_refund_policy', description: '获取 Nova 的退货退款政策。', input_schema: { type: 'object', properties: {} } },
      run: () => nova.refundPolicy(),
    },
    {
      spec: {
        name: 'get_shipping',
        description: '查询订单的物流状态。',
        input_schema: { type: 'object', properties: { order_id: { type: 'string', description: '订单号，例如 NV-100001' } }, required: ['order_id'] },
      },
      run: (i) => nova.getShipping(i.order_id),
    },
  ]
}

const GOALS = {
  full: '我是 alice@example.com。帮我：1）看看我所有待发货的订单；2）把智能门锁那单取消；3）告诉我退货政策；4）空调订单 NV-100001 现在到哪了？',
  handoff: '我是 alice@example.com，帮我查一下我待发货的订单；然后把它取消。',
  replan: '把我的空调订单 NV-100001 取消掉；再告诉我退货政策。',
  badPlan: '告诉我退货政策；再查一下订单 NV-100004 到哪了。',
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
const ORDER = /NV-\d{6}/

/** “模型”按用户请求里的每个分句拆步骤 */
function planFor(goal: string): Plan {
  const email = goal.match(EMAIL)?.[0] ?? ''
  const tasks: string[] = []
  for (const clause of goal.split(/[；;。？?]/)) {
    const id = clause.match(ORDER)?.[0]
    if (/取消/.test(clause)) tasks.push(id ? `取消订单 ${id}` : /门锁/.test(clause) ? '取消智能门锁订单' : '取消上一步查到的待发货订单')
    else if (/到哪|物流/.test(clause) && id) tasks.push(`查询订单 ${id} 的物流`)
    else if (/退货|退款|政策/.test(clause)) tasks.push('查询退货政策')
    else if (/待发货/.test(clause)) tasks.push(`查询 ${email} 的所有待发货订单`)
  }
  return { steps: tasks.map((task, i) => ({ id: i + 1, task })) }
}

function planner(req: ChatRequest, ctx: MockContext): MockReply {
  const request = firstUserText(req)
  if (req.messages.length > 1) {
    // 带着校验错误的重试：错误里点名了 task 字段才能改对
    if (/task/.test(lastUserText(req))) return say(JSON.stringify(planFor(request)))
    return say(JSON.stringify({ steps: [{ step: '查询退货政策' }, { step: '查物流' }] }))
  }
  if (ctx.scenario === 'bad-plan') return say('好的！计划如下：\n```json\n{"steps": [{"step": "查询退货政策"}, {"step": "查物流"}]}\n```')
  if (ctx.state.planned) {
    // 重新规划：只有看到失败原因，才知道该换条路
    const failed = request.match(/(NV-\d{6}) 已发货/)
    if (!failed) return say(JSON.stringify(planFor(request)))
    const steps = [`查询订单 ${failed[1]} 的物流`]
    if (/退货|政策/.test(request)) steps.push('查询退货政策，说明签收后如何退货')
    return say(JSON.stringify({ steps: steps.map((task, i) => ({ id: i + 1, task })) }))
  }
  ctx.state.planned = true
  return say(JSON.stringify(planFor(request)))
}

function report(ctx: MockContext, text: string): MockReply {
  ;((ctx.state.outputs ??= []) as string[]).push(text)
  return say(text)
}

function executor(req: ChatRequest, ctx: MockContext): MockReply {
  const prompt = firstUserText(req)
  const cur = prompt.match(/当前步骤[^：:\n]*[：:]\s*(.+)/)?.[1] ?? prompt
  const last = lastToolResults(req)
  const pendingInPrompt = prompt.match(/待发货订单：[^\n]*?(NV-\d{6})/)?.[1]
  const email = (cur.match(EMAIL) ?? prompt.match(EMAIL))?.[0]

  if (!last.length) {
    if (/取消/.test(cur)) {
      const id = cur.match(ORDER)?.[0] ?? pendingInPrompt
      if (id) return callTool(ctx, 'cancel_order', { order_id: id, reason: '用户要求取消' })
      if (!email) return report(ctx, '步骤失败：不知道要取消哪个订单。')
      return callTool(ctx, 'search_orders', { customer_email: email, status: 'pending' }, '我先查一下待发货的订单。')
    }
    if (/物流|到哪/.test(cur)) return callTool(ctx, 'get_shipping', { order_id: cur.match(ORDER)?.[0] ?? '' })
    if (/退货|政策/.test(cur)) return callTool(ctx, 'get_refund_policy', {})
    if (/待发货/.test(cur) && email) return callTool(ctx, 'search_orders', { customer_email: email, status: 'pending' })
    return report(ctx, `步骤失败：看不懂这个步骤（${cur.slice(0, 30)}）。`)
  }

  const used = allToolUses(req).at(-1)!.name
  const r = last[0]
  if (used === 'search_orders') {
    const orders = JSON.parse(r.content) as { id: string; product: string; amount: number }[]
    if (/取消/.test(cur) && orders[0]) return callTool(ctx, 'cancel_order', { order_id: orders[0].id, reason: '用户要求取消' })
    return report(ctx, orders.length ? `待发货订单：${orders.map((o) => `${o.id}（${o.product}，¥${o.amount}）`).join('、')}` : '没有待发货的订单。')
  }
  if (used === 'cancel_order') {
    if (r.is_error) return report(ctx, `步骤失败：${r.content.replace(/^错误：/, '')}`)
    return report(ctx, `已取消订单 ${JSON.parse(r.content).orderId}。`)
  }
  if (used === 'get_refund_policy') return report(ctx, `退货政策：${r.content}`)
  if (used === 'get_shipping') {
    if (r.is_error) return report(ctx, `步骤失败：${r.content}`)
    const s = JSON.parse(r.content)
    return report(ctx, `订单 ${s.orderId} 由${s.carrier}承运，当前状态：${s.status}。`)
  }
  return report(ctx, '步骤完成。')
}

function synthesizer(req: ChatRequest, ctx: MockContext): MockReply {
  const seen = visibleText(req)
  const facts = ((ctx.state.outputs ?? []) as string[]).filter((o) => seen.includes(o))
  if (!facts.length) return say('您好，您的请求已处理。')
  return say(`您好，您的几件事处理结果如下：\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`)
}

const isPlanning = (req: ChatRequest) => !req.tools?.length && /json/i.test(visibleText(req))
const isExecutor = (req: ChatRequest) => !!req.tools?.length

function lastCall(ctx: ScenarioCtx) {
  return ctx.trace.llmCalls().at(-1)!.request
}

export const suite: LevelSuite = {
  budgets: { calls: 32, tokens: 17500 },
  mock(req, ctx) {
    if (isExecutor(req)) return executor(req, ctx)
    if (isPlanning(req)) return planner(req, ctx)
    return synthesizer(req, ctx)
  },
  scenarios: [
    {
      id: 'plan-execute',
      title: '先规划，再按序执行',
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        const nova = createNova()
        const r = await planAndExecute(GOALS.full, orderTools(nova))
        const calls = ctx.trace.llmCalls()
        ctx.assert(isPlanning(calls[0].request), '第一次调用应该是规划：不带 tools，要求模型只输出 JSON 计划')
        ctx.eq(r.plan.steps.length, 4, '用户提了 4 件事，计划应该有 4 步')
        ctx.eq(
          ctx.trace.toolCalls().map((c) => c.name),
          ['searchOrders', 'cancelOrder', 'refundPolicy', 'getShipping'],
          '工具的执行顺序应该和计划的步骤顺序一致：逐步执行，一步做完再做下一步',
        )
        ctx.assert(!lastCall(ctx).tools?.length, '最后一次调用应该是汇总：根据各步骤的结果写最终回复（不需要带 tools）')
        ctx.eq(r.stepResults.length, 4, 'stepResults 应该有 4 条，每步一条')
        ctx.assert(r.stepResults.every((s) => s.ok), '4 个步骤都应该成功')
        for (const [needle, what] of [
          ['NV-100002', '待发货的订单'],
          ['已取消订单 NV-100002', '门锁订单已取消'],
          ['签收后 7 天', '退货政策'],
          ['上海转运中心', '空调的物流'],
        ])
          ctx.includes(r.output, needle, `最终回复漏掉了「${what}」——汇总时要把每个步骤的结果都交给模型`)
        ctx.assert(calls.length <= 10, `一共调用了 ${calls.length} 次模型；4 步计划应该是 1 次规划 + 每步 2 次 + 1 次汇总 = 10 次`)
      },
    },
    {
      id: 'handoff',
      title: '步骤之间只传结果',
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        const nova = createNova()
        const r = await planAndExecute(GOALS.handoff, orderTools(nova))
        ctx.eq(r.plan.steps.length, 2, '计划应该有 2 步：查待发货订单 → 取消它')
        ctx.eq(nova.orders.find((o) => o.id === 'NV-100002')?.status, 'cancelled', '待发货的订单 NV-100002 应该被取消')
        const exec = ctx.trace.llmCalls().filter((c) => isExecutor(c.request))
        for (const c of exec)
          ctx.assert(
            c.request.messages.length <= 3,
            `执行某个步骤时带了 ${c.request.messages.length} 条消息。每个步骤应该从一段新对话开始，只带上之前步骤的**结果**，而不是把整段对话记录都塞进去`,
          )
        const stepStarts = exec.filter((c) => c.request.messages.length === 1)
        ctx.eq(stepStarts.length, 2, '每个步骤都应该单独调用一次 runAgent')
        ctx.includes(firstUserText(stepStarts[1].request), 'NV-100002', '第 2 步的提示里应该带上第 1 步的结果（查到的订单号）')
        ctx.includes(firstUserText(stepStarts[1].request), '当前步骤', '执行提示里要用“当前步骤：”标出这一步要做什么')
        ctx.eq(ctx.trace.toolCalls('searchOrders').length, 1, '第 2 步拿到了第 1 步的结果，就不需要再查一遍订单')
        ctx.includes(r.output, '已取消订单 NV-100002', '最终回复应告知已取消')
      },
    },
    {
      id: 'replan',
      title: '步骤失败 → 重新规划',
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        let r: Awaited<ReturnType<Mod['planAndExecute']>>
        try {
          r = await planAndExecute(GOALS.replan, orderTools(createNova()))
        } catch (e) {
          return ctx.fail(`planAndExecute 抛出了异常：${(e as Error).message}\n某一步失败时不应该崩溃，而应该带着错误重新规划`)
        }
        ctx.assert(
          r.stepResults.some((s) => !s.ok && s.output.includes('已发货')),
          '取消已发货订单的那一步应该被记为失败（ok: false），output 里保留失败原因',
        )
        const plans = ctx.trace.llmCalls().filter((c) => isPlanning(c.request))
        ctx.eq(plans.length, 2, '应该恰好规划 2 次：初始计划 + 失败后重新规划一次')
        ctx.includes(visibleText(plans[1].request), '已发货', '重新规划时要把失败原因告诉模型，它才知道该换条路')
        ctx.eq(ctx.trace.toolCalls('cancelOrder').length, 1, '失败的取消操作不应该被重复执行')
        ctx.includes(r.output, '上海转运中心', '重新规划后应该改为查询物流')
        ctx.includes(r.output, '签收后', '原计划里的“退货政策”也不能丢')
      },
    },
    {
      id: 'bad-plan',
      title: '计划格式不合法',
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        let r: Awaited<ReturnType<Mod['planAndExecute']>>
        try {
          r = await planAndExecute(GOALS.badPlan, orderTools(createNova()))
        } catch (e) {
          return ctx.fail(`planAndExecute 抛出了异常：${(e as Error).message}\n计划不合法时应该带着校验错误重试一次`)
        }
        const calls = ctx.trace.llmCalls()
        ctx.assert(!isExecutor(calls[0].request) && !isExecutor(calls[1].request), '计划通过 zod 校验之前，不能开始执行任何步骤')
        ctx.eq(
          calls[1].request.messages.map((m) => m.role),
          ['user', 'assistant', 'user'],
          '重试规划时应该带上：原请求(user) → 模型的错误输出(assistant) → 校验错误(user)',
        )
        ctx.includes(lastUserText(calls[1].request), 'task', '反馈给模型的错误要点名出错的字段（缺少 task）')
        ctx.eq(r.plan.steps.length, 2, '修正后的计划应该有 2 步')
        ctx.includes(r.output, '派送中', '最终回复应包含 NV-100004 的物流')
        ctx.includes(r.output, '签收后', '最终回复应包含退货政策')
      },
    },
  ],
}
