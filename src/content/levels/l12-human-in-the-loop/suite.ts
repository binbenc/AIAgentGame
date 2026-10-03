import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolResults, allToolUses, callTools, firstUserText, say } from '../../../engine/llm/mock-kit'
import type { Message, ToolResultBlock } from '../../../engine/llm/types'
import { __delay, __traced } from '../../../engine/runtime/api'
import { createNova, type NovaApi, type Tool } from '../../shared/nova'
import { L } from '../../../engine/locale'

type ApprovalTool = Tool & { requiresApproval?: boolean }
type Pending = { toolUseId: string; name: string; input: any }
type RunResult = { status: string; output?: string; pending?: Pending; state: unknown }
type Mod = {
  runWithApproval(task: string, tools: ApprovalTool[], opts?: object): Promise<RunResult>
  resumeWithApproval(state: unknown, decision: { approve: boolean; note?: string }, tools: ApprovalTool[], opts?: object): Promise<RunResult>
}

const REFUND_TASK = L('订单 NV-100001 的空调有质量问题，帮我退款 3999 元。', 'The AC from order NV-100001 is defective. Please refund me ¥3999.')
const REJECT_NOTE = L('金额超过 ¥2000，需要主管线下复核', 'Amount is over ¥2000 and needs an offline review by a supervisor')
/** 拒绝时 tool_result 的固定前缀（英文版与 solution.en 保持一致） */
const REJECTED = L('人工审批拒绝', 'Rejected by human reviewer')

function supportTools(nova: NovaApi): ApprovalTool[] {
  const issueRefund = __traced('issueRefund', async (orderId: string, amount: number) => {
    await __delay(300)
    return { refundId: `RF-${orderId.slice(3)}`, orderId, amount, status: L('已提交', 'submitted') }
  })
  return [
    {
      spec: {
        name: 'get_order',
        description: L('查询订单详情（商品、金额、状态）。', 'Look up order details (product, amount, status).'),
        input_schema: { type: 'object', properties: { order_id: { type: 'string', description: L('订单号，例如 NV-100001', 'Order number, e.g. NV-100001') } }, required: ['order_id'] },
      },
      run: async (i) => {
        const { id, product, amount, status } = await nova.getOrder(i.order_id)
        return { id, product, amount, status }
      },
    },
    {
      spec: { name: 'get_refund_policy', description: L('获取 Nova 的退货退款政策。', "Get Nova's return and refund policy."), input_schema: { type: 'object', properties: {} } },
      run: () => nova.refundPolicy(),
    },
    {
      spec: {
        name: 'issue_refund',
        description: L('为订单发起退款，钱会直接退回客户账户。', "Issue a refund for an order. The money goes straight back to the customer's account."),
        input_schema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: L('订单号', 'Order number') },
            amount: { type: 'number', description: L('退款金额（元）', 'Refund amount (¥)') },
            reason: { type: 'string', description: L('退款原因', 'Reason for the refund') },
          },
          required: ['order_id', 'amount', 'reason'],
        },
      },
      requiresApproval: true,
      run: (i) => issueRefund(i.order_id, i.amount),
    },
  ]
}

/** 递归比较：JSON 往返之后结构是否完全一致（函数、undefined、Map、Date 等都会露馅） */
function jsonSafe(v: unknown, path = 'state'): string | null {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? null : L(`${path} 是 ${v}`, `${path} is ${v}`)
  if (typeof v !== 'object') return L(`${path} 的类型是 ${typeof v}`, `${path} has type ${typeof v}`)
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = jsonSafe(v[i], `${path}[${i}]`)
      if (p) return p
    }
    return null
  }
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null)
    return L(
      `${path} 是 ${proto?.constructor?.name ?? '类实例'}，不是普通对象`,
      `${path} is a ${proto?.constructor?.name ?? 'class instance'}, not a plain object`,
    )
  for (const [k, x] of Object.entries(v)) {
    const p = jsonSafe(x, `${path}.${k}`)
    if (p) return p
  }
  return null
}

function roundTrip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

async function pauseOnRefund(ctx: ScenarioCtx, mod: Mod, nova: NovaApi): Promise<RunResult> {
  const r = await mod.runWithApproval(REFUND_TASK, supportTools(nova))
  ctx.eq(
    r.status,
    'needs_approval',
    L(
      '模型想调用 issue_refund（requiresApproval: true），应该暂停并返回 status: "needs_approval"',
      'The model wants to call issue_refund (requiresApproval: true). Pause and return status: "needs_approval"',
    ),
  )
  ctx.eq(ctx.trace.toolCalls('issueRefund').length, 0, L('审批之前绝对不能执行退款', 'The refund must never run before approval'))
  return r
}

function toolResults(messages: Message[]): ToolResultBlock[] {
  return messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b): b is ToolResultBlock => b.type === 'tool_result')
}

export const suite: LevelSuite = {
  budgets: L({ calls: 7, tokens: 2350 }, { calls: 7, tokens: 2200 }),
  mock(req, ctx) {
    const task = firstUserText(req)
    const used = allToolUses(req)
    const id = task.match(/NV-\d{6}/)?.[0] ?? ''
    if (!used.length) {
      if (/退款|refund/i.test(task)) {
        const m = task.match(/(\d+)\s*元|¥\s*(\d+)/)
        const amount = Number(m?.[1] ?? m?.[2] ?? 0)
        return callTools(
          ctx,
          [
            { name: 'get_order', input: { order_id: id } },
            { name: 'issue_refund', input: { order_id: id, amount, reason: L('空调质量问题', 'Defective AC') } },
          ],
          L('我来核对订单，并为您提交退款。', "I'll check the order and submit the refund for you."),
        )
      }
      return callTools(ctx, [
        { name: 'get_order', input: { order_id: id } },
        { name: 'get_refund_policy', input: {} },
      ])
    }
    const results = allToolResults(req)
    const resultOf = (name: string) => {
      const use = used.find((u) => u.name === name)
      return use && results.find((r) => r.tool_use_id === use.id)
    }
    const refund = resultOf('issue_refund')
    if (refund) {
      if (refund.is_error) {
        const note = refund.content.replace(/^.*?(审批拒绝|rejected by human reviewer|rejected)[：:]\s*/i, '')
        return say(
          L(
            `抱歉，您的退款申请没有通过人工审核（${note}）。客服专员会尽快联系您处理。`,
            `Sorry, your refund request was not approved by our reviewers (${note}). A support specialist will contact you shortly.`,
          ),
        )
      }
      const x = JSON.parse(refund.content)
      return say(
        L(
          `已为您提交退款 ¥${x.amount}（退款单号 ${x.refundId}），预计 1–3 个工作日原路退回。`,
          `Refund of ¥${x.amount} submitted (refund ID ${x.refundId}). It should reach your original payment method within 1–3 business days.`,
        ),
      )
    }
    const order = JSON.parse(resultOf('get_order')?.content ?? '{}')
    const policy = resultOf('get_refund_policy')?.content
    return say(
      L(
        `订单 ${order.id}（${order.product}）目前状态：${order.status}。退货政策：${policy ?? '暂无'}`,
        `Order ${order.id} (${order.product}) is currently ${order.status}. Return policy: ${policy ?? 'not available'}`,
      ),
    )
  },
  scenarios: [
    {
      id: 'pause',
      title: L('危险操作：暂停等审批', 'Dangerous action: pause for approval'),
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const r = await pauseOnRefund(ctx, mod, createNova())
        ctx.eq(r.pending?.name, 'issue_refund', L('pending 应该是等待审批的那个工具调用', 'pending should be the tool call waiting for approval'))
        ctx.eq(
          r.pending?.input?.amount,
          3999,
          L('pending.input 要原样带上模型给出的参数，审批人才知道在批什么', "pending.input must carry the model's arguments as is, so the approver knows what they're approving"),
        )
        ctx.assert(typeof r.pending?.toolUseId === 'string', L('pending.toolUseId 应该是对应 tool_use 块的 id', 'pending.toolUseId should be the id of the matching tool_use block'))
        ctx.eq(
          ctx.trace.toolCalls('getOrder').length,
          1,
          L('同一轮里的安全工具（get_order）应该照常执行，不用等审批', 'Safe tools in the same turn (get_order) should run as usual without waiting for approval'),
        )
        const problem = jsonSafe(r.state)
        ctx.assert(
          !problem,
          L(`state 必须是纯 JSON 数据（要存进数据库，几小时后再恢复）：${problem}`, `state must be plain JSON data (it goes into a database and is resumed hours later): ${problem}`),
        )
        const dump = JSON.stringify(r.state)
        ctx.includes(
          dump,
          r.pending!.toolUseId,
          L('state 里要保存模型这一轮的回复（包含等待审批的 tool_use）', "state must keep the model's reply for this turn (including the tool_use waiting for approval)"),
        )
        ctx.includes(
          dump,
          L('智能空调 X1', 'Smart AC X1'),
          L(
            'state 里要保存同一轮已经执行完的安全工具结果，恢复时不必重新执行',
            "state must keep the results of safe tools that already ran this turn, so they don't run again on resume",
          ),
        )
      },
    },
    {
      id: 'approve',
      title: L('批准 → 执行一次', 'Approve → run once'),
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const nova = createNova()
        const r = await pauseOnRefund(ctx, mod, nova)
        // 模拟：状态存进数据库，几小时后在另一个进程里取出来恢复
        const saved = roundTrip(r.state)
        // 用全新加载的模块恢复：模块级变量里藏的状态在“另一个进程”里是拿不到的
        const fresh = ctx.loadFresh<Mod>('approval.ts')
        const done = await fresh.resumeWithApproval(saved, { approve: true, note: L('主管已确认质量问题', 'Supervisor confirmed the defect') }, supportTools(nova))
        ctx.eq(done.status, 'done', L('批准后应该执行工具，并让模型给出最终回复', 'After approval, run the tool and let the model give its final reply'))
        ctx.eq(ctx.trace.toolCalls('issueRefund').length, 1, L('批准后退款应该执行，而且只执行一次', 'After approval the refund should run, exactly once'))
        ctx.eq(
          ctx.trace.toolCalls('getOrder').length,
          1,
          L('安全工具在暂停前已经执行过了，恢复时不应该再执行一次', 'The safe tool already ran before the pause and should not run again on resume'),
        )
        ctx.includes(done.output, L('已为您提交退款 ¥3999', 'Refund of ¥3999 submitted'), L('模型应该根据退款结果回复用户', 'The model should reply to the user based on the refund result'))
        const req = ctx.trace.llmCalls()[1].request
        const last = req.messages[req.messages.length - 1]
        ctx.assert(
          last.role === 'user' && Array.isArray(last.content) && last.content.filter((b) => b.type === 'tool_result').length === 2,
          L(
            '恢复后，get_order 和 issue_refund 的两个 tool_result 应该放在**同一条** user 消息里',
            'After resuming, the two tool_results for get_order and issue_refund should be in **one** user message',
          ),
        )
      },
    },
    {
      id: 'reject',
      title: L('拒绝 → 告知模型', 'Reject → tell the model'),
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const nova = createNova()
        const r = await pauseOnRefund(ctx, mod, nova)
        const done = await ctx.loadFresh<Mod>('approval.ts').resumeWithApproval(roundTrip(r.state), { approve: false, note: REJECT_NOTE }, supportTools(nova))
        ctx.eq(ctx.trace.toolCalls('issueRefund').length, 0, L('被拒绝的工具调用绝对不能执行', 'A rejected tool call must never run'))
        ctx.eq(done.status, 'done', L('拒绝后也要继续对话，让模型告诉用户结果', 'After a rejection, keep the conversation going so the model can tell the user'))
        const req = ctx.trace.llmCalls()[1].request
        const rejected = toolResults(req.messages).find((b) => b.tool_use_id === r.pending?.toolUseId)
        ctx.assert(rejected?.is_error, L('拒绝时应该给这个 tool_use 回填一个 is_error: true 的 tool_result', 'On rejection, add an is_error: true tool_result for this tool_use'))
        ctx.includes(rejected!.content, REJECTED, L('tool_result 内容应该写明“人工审批拒绝：<原因>”', 'The tool_result content should say "Rejected by human reviewer: <reason>"'))
        ctx.includes(rejected!.content, REJECT_NOTE, L('审批人的备注要带给模型', "Pass the approver's note on to the model"))
        ctx.includes(done.output, L('没有通过人工审核', 'was not approved'), L('模型应该如实告诉用户退款没有通过审核', 'The model should tell the user honestly that the refund was not approved'))
      },
    },
    {
      id: 'safe-flow',
      title: L('安全操作不打扰人', "Safe actions don't bother anyone"),
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const r = await mod.runWithApproval(
          L('帮我看看订单 NV-100002 的状态，再说一下退货政策。', 'Check the status of order NV-100002 and tell me your return policy.'),
          supportTools(createNova()),
        )
        ctx.eq(r.status, 'done', L('只调用了不需要审批的工具，应该直接完成，不要暂停', 'Only tools that need no approval were called, so finish without pausing'))
        ctx.includes(r.output, L('智能门锁 L2', 'Smart Lock L2'), L('应该返回订单信息', 'Should return the order details'))
        ctx.includes(r.output, L('签收后 7 天', 'within 7 days of delivery'), L('应该返回退货政策', 'Should return the return policy'))
        ctx.eq(ctx.trace.llmCalls().length, 2, L('应该调用 2 次模型', 'Should call the model 2 times'))
      },
    },
  ],
}
