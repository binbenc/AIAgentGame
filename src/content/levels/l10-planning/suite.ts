import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import type { MockContext, MockReply } from '../../../engine/llm/providers/mock'
import { allToolUses, callTool, firstUserText, lastToolResults, lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
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
        description: L(
          '按客户邮箱查询订单，可按状态过滤（pending=待发货，shipped=已发货，delivered=已签收，cancelled=已取消）。',
          "Look up a customer's orders by email, optionally filtered by status (pending, shipped, delivered, cancelled).",
        ),
        input_schema: {
          type: 'object',
          properties: {
            customer_email: { type: 'string', description: L('客户邮箱', 'Customer email') },
            status: { type: 'string', enum: ['pending', 'shipped', 'delivered', 'cancelled'], description: L('可选，订单状态', 'Optional order status') },
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
        description: L('取消一个尚未发货的订单；已发货的订单无法取消。', "Cancel an order that hasn't shipped yet. Shipped orders can't be cancelled."),
        input_schema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: L('订单号，例如 NV-100001', 'Order id, e.g. NV-100001') },
            reason: { type: 'string', description: L('取消原因', 'Cancellation reason') },
          },
          required: ['order_id', 'reason'],
        },
      },
      run: (i) => nova.cancelOrder(i.order_id, i.reason),
    },
    {
      spec: { name: 'get_refund_policy', description: L('获取 Nova 的退货退款政策。', "Get Nova's return and refund policy."), input_schema: { type: 'object', properties: {} } },
      run: () => nova.refundPolicy(),
    },
    {
      spec: {
        name: 'get_shipping',
        description: L('查询订单的物流状态。', 'Get the shipping status of an order.'),
        input_schema: {
          type: 'object',
          properties: { order_id: { type: 'string', description: L('订单号，例如 NV-100001', 'Order id, e.g. NV-100001') } },
          required: ['order_id'],
        },
      },
      run: (i) => nova.getShipping(i.order_id),
    },
  ]
}

const GOALS = L(
  {
    full: '我是 alice@example.com。帮我：1）看看我所有待发货的订单；2）把智能门锁那单取消；3）告诉我退货政策；4）空调订单 NV-100001 现在到哪了？',
    handoff: '我是 alice@example.com，帮我查一下我待发货的订单；然后把它取消。',
    replan: '把我的空调订单 NV-100001 取消掉；再告诉我退货政策。',
    badPlan: '告诉我退货政策；再查一下订单 NV-100004 到哪了。',
  },
  {
    full: "I'm alice@example.com. Please: 1) show me all my pending orders; 2) cancel the smart lock order; 3) tell me the return policy; 4) where is my AC order NV-100001 now?",
    handoff: "I'm alice@example.com. Please look up my pending order; then cancel it.",
    replan: 'Cancel my AC order NV-100001; then tell me the return policy.',
    badPlan: 'Tell me the return policy; then check where order NV-100004 is.',
  },
)

const CANCEL_REASON = L('用户要求取消', 'Customer requested cancellation')
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
const ORDER = /NV-\d{6}/

/** “模型”按用户请求里的每个分句拆步骤 */
function planFor(goal: string): Plan {
  const email = goal.match(EMAIL)?.[0] ?? ''
  const tasks: string[] = []
  for (const clause of goal.split(L(/[；;。？?]/, /[；;。？?]|\.\s/))) {
    const id = clause.match(ORDER)?.[0]
    if (/取消|cancel/i.test(clause))
      tasks.push(
        id
          ? L(`取消订单 ${id}`, `Cancel order ${id}`)
          : /门锁|lock/i.test(clause)
            ? L('取消智能门锁订单', 'Cancel the smart lock order')
            : L('取消上一步查到的待发货订单', 'Cancel the pending order found in the previous step'),
      )
    else if (/到哪|物流|where|shipping/i.test(clause) && id) tasks.push(L(`查询订单 ${id} 的物流`, `Check shipping for order ${id}`))
    else if (/退货|退款|政策|return|refund|policy/i.test(clause)) tasks.push(L('查询退货政策', 'Look up the return policy'))
    else if (/待发货|pending/i.test(clause)) tasks.push(L(`查询 ${email} 的所有待发货订单`, `Find all pending orders for ${email}`))
  }
  return { steps: tasks.map((task, i) => ({ id: i + 1, task })) }
}

function planner(req: ChatRequest, ctx: MockContext): MockReply {
  const request = firstUserText(req)
  if (req.messages.length > 1) {
    // 带着校验错误的重试：错误里点名了 task 字段才能改对
    if (/task/.test(lastUserText(req))) return say(JSON.stringify(planFor(request)))
    return say(JSON.stringify({ steps: [{ step: L('查询退货政策', 'Look up the return policy') }, { step: L('查物流', 'Check shipping') }] }))
  }
  if (ctx.scenario === 'bad-plan')
    return say(
      L(
        '好的！计划如下：\n```json\n{"steps": [{"step": "查询退货政策"}, {"step": "查物流"}]}\n```',
        'Sure! Here is the plan:\n```json\n{"steps": [{"step": "Look up the return policy"}, {"step": "Check shipping"}]}\n```',
      ),
    )
  if (ctx.state.planned) {
    // 重新规划：只有看到失败原因，才知道该换条路
    const failed = request.match(/(NV-\d{6}) 已发货|(NV-\d{6}) has already shipped/)
    if (!failed) return say(JSON.stringify(planFor(request)))
    const failedId = failed[1] ?? failed[2]
    const steps = [L(`查询订单 ${failedId} 的物流`, `Check shipping for order ${failedId}`)]
    if (/退货|政策|return|policy/i.test(request))
      steps.push(L('查询退货政策，说明签收后如何退货', 'Look up the return policy and explain how to return after delivery'))
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
  const cur = prompt.match(/(?:当前步骤|current step)[^：:\n]*[：:]\s*(.+)/i)?.[1] ?? prompt
  const last = lastToolResults(req)
  const pendingInPrompt = prompt.match(/(?:待发货订单：|Pending orders:)[^\n]*?(NV-\d{6})/)?.[1]
  const email = (cur.match(EMAIL) ?? prompt.match(EMAIL))?.[0]

  if (!last.length) {
    if (/取消|cancel/i.test(cur)) {
      const id = cur.match(ORDER)?.[0] ?? pendingInPrompt
      if (id) return callTool(ctx, 'cancel_order', { order_id: id, reason: CANCEL_REASON })
      if (!email) return report(ctx, L('步骤失败：不知道要取消哪个订单。', 'Step failed: not sure which order to cancel.'))
      return callTool(ctx, 'search_orders', { customer_email: email, status: 'pending' }, L('我先查一下待发货的订单。', 'Let me look up the pending orders first.'))
    }
    if (/物流|到哪|shipping|where/i.test(cur)) return callTool(ctx, 'get_shipping', { order_id: cur.match(ORDER)?.[0] ?? '' })
    if (/退货|政策|return|refund|policy/i.test(cur)) return callTool(ctx, 'get_refund_policy', {})
    if (/待发货|pending/i.test(cur) && email) return callTool(ctx, 'search_orders', { customer_email: email, status: 'pending' })
    return report(ctx, L(`步骤失败：看不懂这个步骤（${cur.slice(0, 30)}）。`, `Step failed: I don't understand this step (${cur.slice(0, 30)}).`))
  }

  const used = allToolUses(req).at(-1)!.name
  const r = last[0]
  if (used === 'search_orders') {
    const orders = JSON.parse(r.content) as { id: string; product: string; amount: number }[]
    if (/取消|cancel/i.test(cur) && orders[0]) return callTool(ctx, 'cancel_order', { order_id: orders[0].id, reason: CANCEL_REASON })
    return report(
      ctx,
      orders.length
        ? L(
            `待发货订单：${orders.map((o) => `${o.id}（${o.product}，¥${o.amount}）`).join('、')}`,
            `Pending orders: ${orders.map((o) => `${o.id} (${o.product}, ¥${o.amount})`).join(', ')}`,
          )
        : L('没有待发货的订单。', 'No pending orders.'),
    )
  }
  if (used === 'cancel_order') {
    if (r.is_error) return report(ctx, L('步骤失败：', 'Step failed: ') + r.content.replace(/^(?:错误：|Error: )/, ''))
    return report(ctx, L(`已取消订单 ${JSON.parse(r.content).orderId}。`, `Cancelled order ${JSON.parse(r.content).orderId}.`))
  }
  if (used === 'get_refund_policy') return report(ctx, L(`退货政策：${r.content}`, `Return policy: ${r.content}`))
  if (used === 'get_shipping') {
    if (r.is_error) return report(ctx, L(`步骤失败：${r.content}`, `Step failed: ${r.content}`))
    const s = JSON.parse(r.content)
    return report(ctx, L(`订单 ${s.orderId} 由${s.carrier}承运，当前状态：${s.status}。`, `Order ${s.orderId} is with ${s.carrier}. Status: ${s.status}.`))
  }
  return report(ctx, L('步骤完成。', 'Step done.'))
}

function synthesizer(req: ChatRequest, ctx: MockContext): MockReply {
  const seen = visibleText(req)
  const facts = ((ctx.state.outputs ?? []) as string[]).filter((o) => seen.includes(o))
  if (!facts.length) return say(L('您好，您的请求已处理。', 'Hi, your request has been handled.'))
  return say(L(`您好，您的几件事处理结果如下：\n`, `Hi, here's where everything stands:\n`) + facts.map((f, i) => `${i + 1}. ${f}`).join('\n'))
}

const isPlanning = (req: ChatRequest) => !req.tools?.length && /json/i.test(visibleText(req))
const isExecutor = (req: ChatRequest) => !!req.tools?.length

function lastCall(ctx: ScenarioCtx) {
  return ctx.trace.llmCalls().at(-1)!.request
}

export const suite: LevelSuite = {
  budgets: L({ calls: 32, tokens: 17500 }, { calls: 32, tokens: 15000 }),
  mock(req, ctx) {
    if (isExecutor(req)) return executor(req, ctx)
    if (isPlanning(req)) return planner(req, ctx)
    return synthesizer(req, ctx)
  },
  scenarios: [
    {
      id: 'plan-execute',
      title: L('先规划，再按序执行', 'Plan first, then execute in order'),
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        const nova = createNova()
        const r = await planAndExecute(GOALS.full, orderTools(nova))
        const calls = ctx.trace.llmCalls()
        ctx.assert(isPlanning(calls[0].request), L('第一次调用应该是规划：不带 tools，要求模型只输出 JSON 计划', 'The first call should be planning: no tools, and the model is asked to output only a JSON plan'))
        ctx.eq(r.plan.steps.length, 4, L('用户提了 4 件事，计划应该有 4 步', 'The user asked for 4 things, so the plan should have 4 steps'))
        ctx.eq(
          ctx.trace.toolCalls().map((c) => c.name),
          ['searchOrders', 'cancelOrder', 'refundPolicy', 'getShipping'],
          L('工具的执行顺序应该和计划的步骤顺序一致：逐步执行，一步做完再做下一步', 'Tools should run in the order of the plan: execute step by step, finishing one before starting the next'),
        )
        ctx.assert(!lastCall(ctx).tools?.length, L('最后一次调用应该是汇总：根据各步骤的结果写最终回复（不需要带 tools）', 'The last call should be the synthesis: write the final reply from the step results (no tools needed)'))
        ctx.eq(r.stepResults.length, 4, L('stepResults 应该有 4 条，每步一条', 'stepResults should have 4 entries, one per step'))
        ctx.assert(r.stepResults.every((s) => s.ok), L('4 个步骤都应该成功', 'All 4 steps should succeed'))
        for (const [needle, what] of L(
          [
            ['NV-100002', '待发货的订单'],
            ['已取消订单 NV-100002', '门锁订单已取消'],
            ['签收后 7 天', '退货政策'],
            ['上海转运中心', '空调的物流'],
          ],
          [
            ['NV-100002', 'the pending order'],
            ['Cancelled order NV-100002', 'the cancelled lock order'],
            ['within 7 days of delivery', 'the return policy'],
            ['Shanghai transit hub', 'the AC shipping status'],
          ],
        ))
          ctx.includes(
            r.output,
            needle,
            L(`最终回复漏掉了「${what}」——汇总时要把每个步骤的结果都交给模型`, `The final reply is missing ${what}: give the synthesizer every step's result`),
          )
        ctx.assert(calls.length <= 10, L(
            `一共调用了 ${calls.length} 次模型；4 步计划应该是 1 次规划 + 每步 2 次 + 1 次汇总 = 10 次`,
            `${calls.length} model calls in total; a 4-step plan should take 1 planning call + 2 per step + 1 synthesis = 10`,
          ))
      },
    },
    {
      id: 'handoff',
      title: L('步骤之间只传结果', 'Pass only results between steps'),
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        const nova = createNova()
        const r = await planAndExecute(GOALS.handoff, orderTools(nova))
        ctx.eq(r.plan.steps.length, 2, L('计划应该有 2 步：查待发货订单 → 取消它', 'The plan should have 2 steps: find the pending order → cancel it'))
        ctx.eq(nova.orders.find((o) => o.id === 'NV-100002')?.status, 'cancelled', L('待发货的订单 NV-100002 应该被取消', 'The pending order NV-100002 should be cancelled'))
        const exec = ctx.trace.llmCalls().filter((c) => isExecutor(c.request))
        for (const c of exec)
          ctx.assert(
            c.request.messages.length <= 3,
            L(
              `执行某个步骤时带了 ${c.request.messages.length} 条消息。每个步骤应该从一段新对话开始，只带上之前步骤的**结果**，而不是把整段对话记录都塞进去`,
              `A step ran with ${c.request.messages.length} messages. Each step should start a fresh conversation carrying only the **results** of earlier steps, not their whole transcripts`,
            ),
          )
        const stepStarts = exec.filter((c) => c.request.messages.length === 1)
        ctx.eq(stepStarts.length, 2, L('每个步骤都应该单独调用一次 runAgent', 'Each step should be its own runAgent call'))
        ctx.includes(firstUserText(stepStarts[1].request), 'NV-100002', L('第 2 步的提示里应该带上第 1 步的结果（查到的订单号）', "Step 2's prompt should include step 1's result (the order id it found)"))
        ctx.includes(
          firstUserText(stepStarts[1].request),
          L<string | RegExp>('当前步骤', /current step/i),
          L('执行提示里要用“当前步骤：”标出这一步要做什么', 'Mark what this step should do with "Current step:" in the executor prompt'),
        )
        ctx.eq(ctx.trace.toolCalls('searchOrders').length, 1, L('第 2 步拿到了第 1 步的结果，就不需要再查一遍订单', "Step 2 already has step 1's result, so there's no need to look up the orders again"))
        ctx.includes(r.output, L('已取消订单 NV-100002', 'Cancelled order NV-100002'), L('最终回复应告知已取消', 'The final reply should confirm the cancellation'))
      },
    },
    {
      id: 'replan',
      title: L('步骤失败 → 重新规划', 'Step fails → replan'),
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        let r: Awaited<ReturnType<Mod['planAndExecute']>>
        try {
          r = await planAndExecute(GOALS.replan, orderTools(createNova()))
        } catch (e) {
          return ctx.fail(
            L(
              `planAndExecute 抛出了异常：${(e as Error).message}\n某一步失败时不应该崩溃，而应该带着错误重新规划`,
              `planAndExecute threw: ${(e as Error).message}\nWhen a step fails, don't crash; replan with the error instead`,
            ),
          )
        }
        ctx.assert(
          r.stepResults.some((s) => !s.ok && s.output.includes(L('已发货', 'already shipped'))),
          L('取消已发货订单的那一步应该被记为失败（ok: false），output 里保留失败原因', 'The step that cancels a shipped order should be recorded as failed (ok: false), with the reason kept in output'),
        )
        const plans = ctx.trace.llmCalls().filter((c) => isPlanning(c.request))
        ctx.eq(plans.length, 2, L('应该恰好规划 2 次：初始计划 + 失败后重新规划一次', 'Plan exactly twice: the initial plan + one replan after the failure'))
        ctx.includes(
          visibleText(plans[1].request),
          L('已发货', 'already shipped'),
          L('重新规划时要把失败原因告诉模型，它才知道该换条路', 'Tell the model why the step failed when replanning, so it knows to take another route'),
        )
        ctx.eq(ctx.trace.toolCalls('cancelOrder').length, 1, L('失败的取消操作不应该被重复执行', "Don't repeat the failed cancellation"))
        ctx.includes(r.output, L('上海转运中心', 'Shanghai transit hub'), L('重新规划后应该改为查询物流', 'After replanning, the agent should check shipping instead'))
        ctx.includes(r.output, L('签收后', 'after delivery'), L('原计划里的“退货政策”也不能丢', "Don't lose the original plan's return policy step"))
      },
    },
    {
      id: 'bad-plan',
      title: L('计划格式不合法', 'Invalid plan format'),
      async run(ctx: ScenarioCtx) {
        const { planAndExecute } = ctx.load<Mod>('planner.ts')
        let r: Awaited<ReturnType<Mod['planAndExecute']>>
        try {
          r = await planAndExecute(GOALS.badPlan, orderTools(createNova()))
        } catch (e) {
          return ctx.fail(
            L(
              `planAndExecute 抛出了异常：${(e as Error).message}\n计划不合法时应该带着校验错误重试一次`,
              `planAndExecute threw: ${(e as Error).message}\nWhen the plan is invalid, retry once with the validation error`,
            ),
          )
        }
        const calls = ctx.trace.llmCalls()
        ctx.assert(!isExecutor(calls[0].request) && !isExecutor(calls[1].request), L('计划通过 zod 校验之前，不能开始执行任何步骤', "Don't execute any step until the plan passes zod validation"))
        ctx.eq(
          calls[1].request.messages.map((m) => m.role),
          ['user', 'assistant', 'user'],
          L('重试规划时应该带上：原请求(user) → 模型的错误输出(assistant) → 校验错误(user)', 'The planning retry should carry: original request (user) → the bad model output (assistant) → validation error (user)'),
        )
        ctx.includes(lastUserText(calls[1].request), 'task', L('反馈给模型的错误要点名出错的字段（缺少 task）', 'The error fed back to the model should name the bad field (task is missing)'))
        ctx.eq(r.plan.steps.length, 2, L('修正后的计划应该有 2 步', 'The corrected plan should have 2 steps'))
        ctx.includes(r.output, L('派送中', 'Out for delivery'), L('最终回复应包含 NV-100004 的物流', "The final reply should include NV-100004's shipping status"))
        ctx.includes(r.output, L('签收后', 'after delivery'), L('最终回复应包含退货政策', 'The final reply should include the return policy'))
      },
    },
  ],
}
