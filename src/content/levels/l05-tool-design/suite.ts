import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolUses, callTool, lastToolResults, lastUserText, say } from '../../../engine/llm/mock-kit'
import type { JSONSchema, Message, ToolSpec } from '../../../engine/llm/types'
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
  budgets: { calls: 7, tokens: 3700 },
  mock(req, ctx) {
    const last = lastToolResults(req)
    const used = allToolUses(req)
    const q = lastUserText(req) || ''
    const task = typeof req.messages[0].content === 'string' ? req.messages[0].content : q
    const notFound = say('抱歉，我没有找到合适的工具来处理这个请求。')

    if (ctx.scenario === 'search') {
      if (!last.length) {
        const t = pickAll(req.tools ?? []).search
        const email = t && prop(t, /email|邮箱/i)
        if (!t || !email) return notFound
        const status = prop(t, /status|状态/i, (p) => Array.isArray(p.enum) && p.enum.includes('shipped'))
        return callTool(ctx, t.name, { [email]: 'bob@example.com', ...(status ? { [status]: 'shipped' } : {}) })
      }
      const orders = JSON.parse(last[0].content) as { id: string; product: string }[]
      return say(`您共有 ${orders.length} 个已发货订单：${orders.map((o) => `${o.id}（${o.product}）`).join('、')}。`)
    }

    // 取消类场景
    if (!used.length) {
      const t = pickAll(req.tools ?? []).cancel
      const order = t && prop(t, /order|订单/i)
      const reason = t && prop(t, /reason|原因/i)
      if (!t || !order || !reason) return notFound
      const id = task.match(/NV-\d{6}/)?.[0] ?? ''
      return callTool(ctx, t.name, { [order]: id, [reason]: '不想要了' })
    }
    if (last[0]?.is_error && /已发货/.test(last[0].content)) {
      const p = pickAll(req.tools ?? []).policy
      if (!p) return say('该订单已发货，无法取消。')
      return callTool(ctx, p.name, {}, '这个订单已经发货了，我查一下退货政策。')
    }
    if (used.length >= 2) return say(`该订单已发货无法取消。不过按照政策：${last[0].content}`)
    return say('已为您取消订单，款项将原路退回。')
  },
  scenarios: [
    {
      id: 'spec',
      title: '工具规范检查',
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const tools = createOrderTools(createNova())
        ctx.eq(tools.length, 3, '应该提供 3 个工具：查询订单、取消订单、退货政策')
        for (const { spec } of tools) {
          ctx.assert(/^[a-z][a-z0-9_]*$/.test(spec.name), `工具名 "${spec.name}" 应该用 snake_case`)
          ctx.assert(spec.description.length >= 20, `工具 ${spec.name} 的 description 太短（至少 20 字）`)
          for (const [k, v] of Object.entries(spec.input_schema.properties ?? {}))
            ctx.assert(v.description, `工具 ${spec.name} 的参数 ${k} 缺少 description`)
        }
        const { search, cancel, policy } = pickTools(tools)
        ctx.assert(search && cancel && policy, '没能识别出三个工具：名字或描述里分别带上 search/查询、cancel/取消、refund policy/退货政策')
        const status = prop(search.spec, /status|状态/i)
        ctx.assert(status, '查询订单工具需要 status 参数')
        ctx.eq(
          [...((search.spec.input_schema.properties![status].enum as string[]) ?? [])].sort(),
          ['cancelled', 'delivered', 'pending', 'shipped'],
          'status 应该是 4 个状态的枚举',
        )
        ctx.assert(!(search.spec.input_schema.required ?? []).includes(status), 'status 应该是选填参数')
        const orderParam = prop(cancel.spec, /order|订单/i)
        ctx.assert(orderParam, '取消工具需要订单号参数')
        ctx.includes(cancel.spec.input_schema.properties![orderParam].description, 'NV-', '订单号参数的 description 要写明格式，例如 NV-100001')
        ctx.eq((cancel.spec.input_schema.required ?? []).length, 2, '取消工具的订单号和原因都应该是必填的')
      },
    },
    {
      id: 'search',
      title: '按状态查询 + 精简返回',
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const r = await runAgent('我的邮箱是 bob@example.com，我有哪些已发货的订单？', createOrderTools(createNova()))
        ctx.includes(r.output, 'NV-100004', '应该列出已发货的订单')
        ctx.assert(!r.output.includes('NV-100003'), '已签收（delivered）的订单不应出现——status 枚举让模型能按状态过滤')
        const result = ctx.trace.llmCalls()[1]?.request.messages.at(-1)
        const text = JSON.stringify(result?.content ?? '')
        ctx.assert(!/_internal|_warehouse|_risk/.test(text), '工具返回值里不能包含 _ 开头的内部字段')
      },
    },
    {
      id: 'cancel-ok',
      title: '取消成功',
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const nova = createNova()
        const r = await runAgent('帮我取消订单 NV-100002，不想要了', createOrderTools(nova))
        ctx.eq(nova.orders.find((o) => o.id === 'NV-100002')?.status, 'cancelled', '订单应该被取消')
        ctx.includes(r.output, '已为您取消', '应告知用户取消成功')
      },
    },
    {
      id: 'cancel-shipped',
      title: '取消失败：优雅降级',
      async run(ctx: ScenarioCtx) {
        const { createOrderTools } = ctx.load<Mod>('toolkit.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        let r: { output: string; messages: Message[] }
        try {
          r = await runAgent('帮我取消订单 NV-100001，不想要了', createOrderTools(createNova()))
        } catch (e) {
          return ctx.fail(`Agent 崩溃了：${(e as Error).message}\n工具抛出的异常应该转成 is_error 的 tool_result 交给模型`)
        }
        const results = r.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result')
        ctx.assert(results.some((b) => b.type === 'tool_result' && b.is_error && b.content.includes('已发货')), '出错的 tool_result 应设置 is_error: true，并包含错误信息')
        ctx.includes(r.output, '签收后', '模型拿到错误后应该转而介绍退货政策')
      },
    },
  ],
}
