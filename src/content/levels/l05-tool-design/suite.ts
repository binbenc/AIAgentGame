import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, lastToolResults, lastUserText, say } from '../../../engine/llm/mock-kit'
import type { JSONSchema, Message, ToolSpec } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { createNova, type Tool } from '../../shared/nova'

type Mod = { createOrderTools(api: unknown): Tool[] }
type AgentMod = { runAgent(task: string, tools: Tool[], opts?: { system?: string }): Promise<{ output: string; messages: Message[] }> }

function prop(t: ToolSpec, re: RegExp, pred: (p: JSONSchema) => boolean = () => true): string | undefined {
  return Object.entries(t.input_schema.properties ?? {}).find(([k, v]) => re.test(`${k} ${v.description ?? ''}`) && pred(v))?.[0]
}

const SEARCH = ['search', 'query', '查询', 'list']
const CANCEL = ['cancel', '取消']
const POLICY = ['policy', 'refund', '政策', '退货']

/** 像模型一样“看名字和描述挑工具”：名字命中优先，其次描述命中 */
function pickSpec(specs: ToolSpec[], keys: string[], exclude: ToolSpec[] = []): ToolSpec | undefined {
  const pool = specs.filter((s) => !exclude.includes(s))
  const hit = (s: string) => keys.some((k) => s.toLowerCase().includes(k))
  return pool.find((s) => hit(s.name)) ?? pool.find((s) => hit(s.description))
}

function pickAll(specs: ToolSpec[]) {
  const cancel = pickSpec(specs, CANCEL)
  const policy = pickSpec(specs, POLICY, cancel ? [cancel] : [])
  const search = pickSpec(specs, SEARCH, [cancel, policy].filter((x): x is ToolSpec => !!x))
  return { search, cancel, policy }
}

function pickTools(tools: Tool[]) {
  const r = pickAll(tools.map((t) => t.spec))
  const back = (s?: ToolSpec) => tools.find((t) => t.spec === s)
  return { search: back(r.search), cancel: back(r.cancel), policy: back(r.policy) }
}

export const suite: LevelSuite = {
  budgets: L({ calls: 7, tokens: 3700 }, { calls: 7, tokens: 3360 }),
  mock(req, ctx) {
    const last = lastToolResults(req)
    const used = allToolUses(req)
    const q = lastUserText(req) || ''
    const task = typeof req.messages[0].content === 'string' ? req.messages[0].content : q
    const notFound = say(L('抱歉，我没有找到合适的工具来处理这个请求。', "Sorry, I couldn't find a suitable tool for this request."))

    if (ctx.scenario === 'search') {
      if (!last.length) {
        const t = pickAll(req.tools ?? []).search
        const email = t && prop(t, /email|邮箱/i)
        if (!t || !email) return notFound
        const status = prop(t, /status|状态/i, (p) => Array.isArray(p.enum) && p.enum.includes('shipped'))
        return callTool(ctx, t.name, { [email]: 'bob@example.com', ...(status ? { [status]: 'shipped' } : {}) })
      }
      const orders = JSON.parse(last[0].content) as { id: string; product: string }[]
      return say(
        L(
          `您共有 ${orders.length} 个已发货订单：${orders.map((o) => `${o.id}（${o.product}）`).join('、')}。`,
          `You have ${orders.length} shipped order(s): ${orders.map((o) => `${o.id} (${o.product})`).join(', ')}.`,
        ),
      )
    }

    // 取消类场景
    if (!used.length) {
      const t = pickAll(req.tools ?? []).cancel
      const order = t && prop(t, /order|订单/i)
      const reason = t && prop(t, /reason|原因/i)
      if (!t || !order || !reason) return notFound
      const id = task.match(/NV-\d{6}/)?.[0] ?? ''
      return callTool(ctx, t.name, { [order]: id, [reason]: L('不想要了', "Don't want it anymore") })
    }
    if (last[0]?.is_error && /已发货|already shipped|has shipped/i.test(last[0].content)) {
      const p = pickAll(req.tools ?? []).policy
      if (!p) return say(L('该订单已发货，无法取消。', "This order has already shipped, so it can't be cancelled."))
      return callTool(ctx, p.name, {}, L('这个订单已经发货了，我查一下退货政策。', 'This order has already shipped. Let me check the return policy.'))
    }
    if (used.length >= 2)
      return say(
        L(`该订单已发货无法取消。不过按照政策：${last[0].content}`, `This order has already shipped and can't be cancelled. But under our policy: ${last[0].content}`),
      )
    return say(L('已为您取消订单，款项将原路退回。', 'Your order has been cancelled. The refund will go back to your original payment method.'))
  },
  scenarios: [
    {
      id: 'spec',
      title: L('工具规范检查', 'Tool convention checks'),
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const tools = createOrderTools(createNova())
        ctx.eq(tools.length, 3, L('应该提供 3 个工具：查询订单、取消订单、退货政策', 'Provide 3 tools: search orders, cancel an order, return policy'))
        for (const { spec } of tools) {
          ctx.assert(/^[a-z][a-z0-9_]*$/.test(spec.name), L(`工具名 "${spec.name}" 应该用 snake_case`, `Tool name "${spec.name}" should be snake_case`))
          ctx.assert(spec.description.length >= 20, L(`工具 ${spec.name} 的 description 太短（至少 20 字）`, `The description of ${spec.name} is too short (at least 20 characters)`))
          for (const [k, v] of Object.entries(spec.input_schema.properties ?? {}))
            ctx.assert(v.description, L(`工具 ${spec.name} 的参数 ${k} 缺少 description`, `Parameter ${k} of ${spec.name} has no description`))
        }
        const { search, cancel, policy } = pickTools(tools)
        ctx.assert(search && cancel && policy, L(
            '没能识别出三个工具：名字或描述里分别带上 search/查询、cancel/取消、refund policy/退货政策',
            "Couldn't identify the three tools: put search, cancel and refund policy in their names or descriptions",
          ))
        const status = prop(search.spec, /status|状态/i)
        ctx.assert(status, L('查询订单工具需要 status 参数', 'The order search tool needs a status parameter'))
        ctx.eq(
          [...((search.spec.input_schema.properties![status].enum as string[]) ?? [])].sort(),
          ['cancelled', 'delivered', 'pending', 'shipped'],
          L('status 应该是 4 个状态的枚举', 'status should be an enum of the 4 statuses'),
        )
        ctx.assert(!(search.spec.input_schema.required ?? []).includes(status), L('status 应该是选填参数', 'status should be optional'))
        const orderParam = prop(cancel.spec, /order|订单/i)
        ctx.assert(orderParam, L('取消工具需要订单号参数', 'The cancel tool needs an order id parameter'))
        ctx.includes(cancel.spec.input_schema.properties![orderParam].description, 'NV-', L('订单号参数的 description 要写明格式，例如 NV-100001', "The order id parameter's description should state the format, e.g. NV-100001"))
        ctx.eq((cancel.spec.input_schema.required ?? []).length, 2, L('取消工具的订单号和原因都应该是必填的', 'Both the order id and the reason of the cancel tool should be required'))
      },
    },
    {
      id: 'search',
      title: L('按状态查询 + 精简返回', 'Search by status + lean results'),
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent(
          L('我的邮箱是 bob@example.com，我有哪些已发货的订单？', 'My email is bob@example.com. Which of my orders have shipped?'),
          createOrderTools(createNova()),
        )
        ctx.includes(r.output, 'NV-100004', L('应该列出已发货的订单', 'List the shipped orders'))
        ctx.assert(!r.output.includes('NV-100003'), L('已签收（delivered）的订单不应出现——status 枚举让模型能按状态过滤', 'Delivered orders should not appear: a status enum lets the model filter by status'))
        const result = ctx.trace.llmCalls()[1]?.request.messages.at(-1)
        const text = JSON.stringify(result?.content ?? '')
        ctx.assert(!/_internal|_warehouse|_risk/.test(text), L('工具返回值里不能包含 _ 开头的内部字段', 'Tool results must not include internal fields starting with _'))
      },
    },
    {
      id: 'cancel-ok',
      title: L('取消成功', 'Successful cancellation'),
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const nova = createNova()
        const r = await runAgent(L('帮我取消订单 NV-100002，不想要了', "Please cancel order NV-100002, I don't want it anymore"), createOrderTools(nova))
        ctx.eq(nova.orders.find((o) => o.id === 'NV-100002')?.status, 'cancelled', L('订单应该被取消', 'The order should be cancelled'))
        ctx.includes(r.output, L('已为您取消', 'has been cancelled'), L('应告知用户取消成功', 'Tell the user the cancellation succeeded'))
      },
    },
    {
      id: 'cancel-shipped',
      title: L('取消失败：优雅降级', 'Failed cancellation: graceful degradation'),
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent(L('帮我取消订单 NV-100001，不想要了', "Please cancel order NV-100001, I don't want it anymore"), createOrderTools(createNova()))
        } catch (e) {
          return ctx.fail(
            L(
              `Agent 崩溃了：${(e as Error).message}\n工具抛出的异常应该转成 is_error 的 tool_result 交给模型`,
              `The agent crashed: ${(e as Error).message}\nTurn exceptions thrown by tools into an is_error tool_result for the model`,
            ),
          )
        }
        const results = r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result')
        ctx.assert(
          results.some((b) => b.type === 'tool_result' && b.is_error && b.content.includes(L('已发货', 'already shipped'))),
          L('出错的 tool_result 应设置 is_error: true，并包含错误信息', 'A failed tool_result should set is_error: true and include the error message'),
        )
        ctx.includes(
          r.output,
          L('签收后', 'within 7 days of delivery'),
          L('模型拿到错误后应该转而介绍退货政策', 'After getting the error, the model should explain the return policy instead'),
        )
      },
    },
  ],
}
