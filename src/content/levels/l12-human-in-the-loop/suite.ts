import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolResults, allToolUses, callTools, firstUserText, say } from '../../../engine/llm/mock-kit'
import type { Message, ToolResultBlock } from '../../../engine/llm/types'
import { __delay, __traced } from '../../../engine/runtime/api'
import { createNova, type NovaApi, type Tool } from '../../shared/nova'

type ApprovalTool = Tool & { requiresApproval?: boolean }
type Pending = { toolUseId: string; name: string; input: any }
type RunResult = { status: string; output?: string; pending?: Pending; state: unknown }
type Mod = {
  runWithApproval(task: string, tools: ApprovalTool[], opts?: object): Promise<RunResult>
  resumeWithApproval(state: unknown, decision: { approve: boolean; note?: string }, tools: ApprovalTool[], opts?: object): Promise<RunResult>
}

const REFUND_TASK = '订单 NV-100001 的空调有质量问题，帮我退款 3999 元。'
const REJECT_NOTE = '金额超过 ¥2000，需要主管线下复核'

function supportTools(nova: NovaApi): ApprovalTool[] {
  const issueRefund = __traced('issueRefund', async (orderId: string, amount: number) => {
    await __delay(300)
    return { refundId: `RF-${orderId.slice(3)}`, orderId, amount, status: '已提交' }
  })
  return [
    {
      spec: {
        name: 'get_order',
        description: '查询订单详情（商品、金额、状态）。',
        input_schema: { type: 'object', properties: { order_id: { type: 'string', description: '订单号，例如 NV-100001' } }, required: ['order_id'] },
      },
      run: async (i) => {
        const { id, product, amount, status } = await nova.getOrder(i.order_id)
        return { id, product, amount, status }
      },
    },
    {
      spec: { name: 'get_refund_policy', description: '获取 Nova 的退货退款政策。', input_schema: { type: 'object', properties: {} } },
      run: () => nova.refundPolicy(),
    },
    {
      spec: {
        name: 'issue_refund',
        description: '为订单发起退款，钱会直接退回客户账户。',
        input_schema: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: '订单号' },
            amount: { type: 'number', description: '退款金额（元）' },
            reason: { type: 'string', description: '退款原因' },
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
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} 是 ${v}`
  if (typeof v !== 'object') return `${path} 的类型是 ${typeof v}`
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = jsonSafe(v[i], `${path}[${i}]`)
      if (p) return p
    }
    return null
  }
  const proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return `${path} 是 ${proto?.constructor?.name ?? '类实例'}，不是普通对象`
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
  ctx.eq(r.status, 'needs_approval', '模型想调用 issue_refund（requiresApproval: true），应该暂停并返回 status: "needs_approval"')
  ctx.eq(ctx.trace.toolCalls('issueRefund').length, 0, '审批之前绝对不能执行退款')
  return r
}

function toolResults(messages: Message[]): ToolResultBlock[] {
  return messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b): b is ToolResultBlock => b.type === 'tool_result')
}

export const suite: LevelSuite = {
  budgets: { calls: 7, tokens: 2350 },
  mock(req, ctx) {
    const task = firstUserText(req)
    const used = allToolUses(req)
    const id = task.match(/NV-\d{6}/)?.[0] ?? ''
    if (!used.length) {
      if (/退款/.test(task)) {
        const amount = Number(task.match(/(\d+)\s*元/)?.[1] ?? 0)
        return callTools(
          ctx,
          [
            { name: 'get_order', input: { order_id: id } },
            { name: 'issue_refund', input: { order_id: id, amount, reason: '空调质量问题' } },
          ],
          '我来核对订单，并为您提交退款。',
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
      if (refund.is_error)
        return say(`抱歉，您的退款申请没有通过人工审核（${refund.content.replace(/^.*?审批拒绝[：:]\s*/, '')}）。客服专员会尽快联系您处理。`)
      const x = JSON.parse(refund.content)
      return say(`已为您提交退款 ¥${x.amount}（退款单号 ${x.refundId}），预计 1–3 个工作日原路退回。`)
    }
    const order = JSON.parse(resultOf('get_order')?.content ?? '{}')
    return say(`订单 ${order.id}（${order.product}）目前状态：${order.status}。退货政策：${resultOf('get_refund_policy')?.content ?? '暂无'}`)
  },
  scenarios: [
    {
      id: 'pause',
      title: '危险操作：暂停等审批',
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const r = await pauseOnRefund(ctx, mod, createNova())
        ctx.eq(r.pending?.name, 'issue_refund', 'pending 应该是等待审批的那个工具调用')
        ctx.eq(r.pending?.input?.amount, 3999, 'pending.input 要原样带上模型给出的参数，审批人才知道在批什么')
        ctx.assert(typeof r.pending?.toolUseId === 'string', 'pending.toolUseId 应该是对应 tool_use 块的 id')
        ctx.eq(ctx.trace.toolCalls('getOrder').length, 1, '同一轮里的安全工具（get_order）应该照常执行，不用等审批')
        const problem = jsonSafe(r.state)
        ctx.assert(!problem, `state 必须是纯 JSON 数据（要存进数据库，几小时后再恢复）：${problem}`)
        const dump = JSON.stringify(r.state)
        ctx.includes(dump, r.pending!.toolUseId, 'state 里要保存模型这一轮的回复（包含等待审批的 tool_use）')
        ctx.includes(dump, '智能空调 X1', 'state 里要保存同一轮已经执行完的安全工具结果，恢复时不必重新执行')
      },
    },
    {
      id: 'approve',
      title: '批准 → 执行一次',
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const nova = createNova()
        const r = await pauseOnRefund(ctx, mod, nova)
        // 模拟：状态存进数据库，几小时后在另一个进程里取出来恢复
        const saved = roundTrip(r.state)
        // 用全新加载的模块恢复：模块级变量里藏的状态在“另一个进程”里是拿不到的
        const fresh = ctx.loadFresh<Mod>('approval.ts')
        const done = await fresh.resumeWithApproval(saved, { approve: true, note: '主管已确认质量问题' }, supportTools(nova))
        ctx.eq(done.status, 'done', '批准后应该执行工具，并让模型给出最终回复')
        ctx.eq(ctx.trace.toolCalls('issueRefund').length, 1, '批准后退款应该执行，而且只执行一次')
        ctx.eq(ctx.trace.toolCalls('getOrder').length, 1, '安全工具在暂停前已经执行过了，恢复时不应该再执行一次')
        ctx.includes(done.output, '已为您提交退款 ¥3999', '模型应该根据退款结果回复用户')
        const req = ctx.trace.llmCalls()[1].request
        const last = req.messages[req.messages.length - 1]
        ctx.assert(
          last.role === 'user' && Array.isArray(last.content) && last.content.filter((b) => b.type === 'tool_result').length === 2,
          '恢复后，get_order 和 issue_refund 的两个 tool_result 应该放在**同一条** user 消息里',
        )
      },
    },
    {
      id: 'reject',
      title: '拒绝 → 告知模型',
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const nova = createNova()
        const r = await pauseOnRefund(ctx, mod, nova)
        const done = await ctx.loadFresh<Mod>('approval.ts').resumeWithApproval(roundTrip(r.state), { approve: false, note: REJECT_NOTE }, supportTools(nova))
        ctx.eq(ctx.trace.toolCalls('issueRefund').length, 0, '被拒绝的工具调用绝对不能执行')
        ctx.eq(done.status, 'done', '拒绝后也要继续对话，让模型告诉用户结果')
        const req = ctx.trace.llmCalls()[1].request
        const rejected = toolResults(req.messages).find((b) => b.tool_use_id === r.pending?.toolUseId)
        ctx.assert(rejected?.is_error, '拒绝时应该给这个 tool_use 回填一个 is_error: true 的 tool_result')
        ctx.includes(rejected!.content, '人工审批拒绝', 'tool_result 内容应该写明“人工审批拒绝：<原因>”')
        ctx.includes(rejected!.content, REJECT_NOTE, '审批人的备注要带给模型')
        ctx.includes(done.output, '没有通过人工审核', '模型应该如实告诉用户退款没有通过审核')
      },
    },
    {
      id: 'safe-flow',
      title: '安全操作不打扰人',
      async run(ctx: ScenarioCtx) {
        const mod = ctx.load<Mod>('approval.ts')
        const r = await mod.runWithApproval('帮我看看订单 NV-100002 的状态，再说一下退货政策。', supportTools(createNova()))
        ctx.eq(r.status, 'done', '只调用了不需要审批的工具，应该直接完成，不要暂停')
        ctx.includes(r.output, '智能门锁 L2', '应该返回订单信息')
        ctx.includes(r.output, '签收后 7 天', '应该返回退货政策')
        ctx.eq(ctx.trace.llmCalls().length, 2, '应该调用 2 次模型')
      },
    },
  ],
}
