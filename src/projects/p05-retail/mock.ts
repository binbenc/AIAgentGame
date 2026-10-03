/**
 * P5 的模拟模型：一个“有能力、但只照它看到的东西办事”的客服模型。
 * - 它从对话里读信息：客户给的邮箱 / 姓名 + 邮编、订单号、原因、地址、支付方式，以及工具返回的用户 id、订单、商品规格；
 * - system 里有“先验证身份”的规则，它才会先验证身份；
 * - system 里有“得到明确确认后再执行”的规则，它才会先列出详情等客户确认，否则直接调用写工具；
 * - system 里有订单状态规则（待发货 / 已签收），它才会按政策拒绝不合规的请求，否则硬着头皮去做，
 *   工具报错后还会“好心”地换一种操作（比如取消不了就直接帮客户退货）；
 * - 它只认识当前请求里的消息：玩家没有把历史带到下一轮，它就会忘记客户是谁。
 * 客户的目标（改哪个商品的哪个规格）按任务 id 取，相当于模型听懂了客户的话；具体的 id、价格、状态都从工具结果里读。
 */
import { callTool, say } from '../../engine/llm/mock-kit'
import type { MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest } from '../../engine/llm/types'
import { isConfirm } from './tasks'

type Kind = 'cancel' | 'address' | 'items' | 'return' | 'exchange'
type Intent = { kind: Kind; product?: string; change?: Record<string, string>; products?: string[] }

const GOALS: Record<string, Intent[]> = {
  'cancel-pending': [{ kind: 'cancel' }],
  'modify-address': [{ kind: 'address' }],
  'modify-items': [{ kind: 'items', product: 'T恤', change: { 尺码: 'L' } }],
  'return-giftcard': [{ kind: 'return', products: ['台灯'] }],
  'exchange-size': [{ kind: 'exchange', product: '跑步鞋', change: { 尺码: '42' } }],
  'refuse-cancel-delivered': [{ kind: 'cancel' }],
  'wrong-email-then-correct': [{ kind: 'cancel' }],
  'two-requests': [{ kind: 'address' }, { kind: 'cancel' }],
}

const TOOL: Record<Kind, string> = {
  cancel: 'cancel_pending_order',
  address: 'modify_pending_order_address',
  items: 'modify_pending_order_items',
  return: 'return_delivered_order_items',
  exchange: 'exchange_delivered_order_items',
}
const WRITES = new Set([...Object.values(TOOL), 'modify_pending_order_payment', 'modify_user_address'])
const NEED: Record<Kind, { status: string; text: string; verb: string }> = {
  cancel: { status: 'pending', text: '待发货', verb: '取消' },
  address: { status: 'pending', text: '待发货', verb: '修改收货地址' },
  items: { status: 'pending', text: '待发货', verb: '修改商品' },
  return: { status: 'delivered', text: '已签收', verb: '退货' },
  exchange: { status: 'delivered', text: '已签收', verb: '换货' },
}

// system 里能看出哪些政策
const AUTH_RE = /验证.{0,10}身份|身份.{0,4}验证|核实.{0,6}身份/
const CONFIRM_RE = /(明确|得到|获得|等待).{0,10}确认|确认.{0,10}(之后|以后|后再|后才|才能)/
const RULES_RE = [/待发货|pending/, /已签收|delivered/]

const ASK_IDENTITY = '您好！为了保护您的账户安全，办理业务前需要先验证您的身份：请提供注册邮箱，或者姓名和邮编。'
const ASK_ORDER = '好的，请问是哪个订单？请提供订单号（例如 #W1234）。'
const ASK_REASON = '请问取消的原因是“不再需要”还是“误下单”？'
const ASK_ADDRESS = '请提供新的收货地址和邮编。'
const ASK_PAY = '差价（如有）用哪种支付方式结算？可以用原支付方式或您账户里的礼品卡。'
const ASK_REFUND = '退款退到原支付方式，还是退到您的礼品卡？'
const ANYTHING_ELSE = '还有其他可以帮您的吗？'

type Ev = { kind: 'user' | 'agent'; text: string } | { kind: 'call'; name: string; input: any; ok: boolean; out: string }

function timeline(req: ChatRequest): Ev[] {
  const results = new Map<string, { content: string; is_error?: boolean }>()
  for (const m of req.messages) for (const b of blocksOf(m.content)) if (b.type === 'tool_result') results.set(b.tool_use_id, b)
  const ev: Ev[] = []
  for (const m of req.messages) {
    const bl = blocksOf(m.content)
    const text = bl.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    if (text) ev.push({ kind: m.role === 'user' ? 'user' : 'agent', text })
    if (m.role === 'assistant')
      for (const b of bl)
        if (b.type === 'tool_use') {
          const r = results.get(b.id)
          ev.push({ kind: 'call', name: b.name, input: b.input, ok: !!r && !r.is_error, out: r?.content ?? '' })
        }
  }
  return ev
}

const json = (s: string): any => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
const normId = (s: string) => (s.startsWith('#') ? s : `#${s}`)
const opts = (o: Record<string, string>) => Object.values(o).join('/')

function latestIdentity(users: string[]) {
  for (const t of [...users].reverse()) {
    const email = t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)
    if (email) return { tool: 'find_user_id_by_email', input: { email: email[0] }, desc: `邮箱 ${email[0]} ` }
    const name = t.match(/我叫([一-龥]{2,3})/)
    const zip = t.match(/邮编\s*(?:是)?\s*(\d{6})/)
    if (name && zip) return { tool: 'find_user_id_by_name_zip', input: { name: name[1], zip: zip[1] }, desc: `姓名 ${name[1]}、邮编 ${zip[1]} ` }
  }
  return null
}

function latestMatch<T>(users: string[], rules: [RegExp, T][]): T | undefined {
  for (const t of [...users].reverse()) for (const [re, v] of rules) if (re.test(t)) return v
  return undefined
}

export const mock: MockModel = (req, ctx) => {
  const goal = GOALS[ctx.scenario.split('#')[0]] ?? []
  const sys = req.system ?? ''
  const know = { auth: AUTH_RE.test(sys), confirm: CONFIRM_RE.test(sys), rules: RULES_RE.every((r) => r.test(sys)) }
  const has = (name: string) => (req.tools ?? []).some((t) => t.name === name)
  if (!has('get_order_details')) return say('抱歉，我这边暂时查不到订单系统，请稍后再试。')

  const ev = timeline(req)
  const users = ev.flatMap((e) => (e.kind === 'user' ? [e.text] : []))
  const calls = ev.filter((e): e is Extract<Ev, { kind: 'call' }> => e.kind === 'call')
  const last = ev[ev.length - 1]

  let authUserId: string | null = null
  let userDetails: any = null
  const orders: Record<string, any> = {}
  const products: Record<string, any> = {}
  for (const c of calls) {
    if (!c.ok) continue
    if (c.name.startsWith('find_user')) authUserId = c.out.replace(/"/g, '').trim()
    else if (c.name === 'get_user_details') userDetails = json(c.out)
    else if (c.name === 'get_order_details' || WRITES.has(c.name)) {
      const o = json(c.out)
      if (o?.order_id) orders[o.order_id] = o
    } else if (c.name === 'get_product_details') {
      const p = json(c.out)
      if (p?.product_id) products[p.product_id] = p
    }
  }

  // —— 刚执行完写操作：汇报结果 ——
  if (last?.kind === 'call' && WRITES.has(last.name)) {
    const oid = normId(String(last.input?.order_id ?? ''))
    if (last.ok) return say(doneText(last.name, oid, last.input))
    // 不懂政策的模型：取消不了已签收的订单，就“好心”地直接办退货
    const o = orders[oid]
    if (!know.rules && last.name === 'cancel_pending_order' && o?.status === 'delivered' && has('return_delivered_order_items'))
      return callTool(ctx, 'return_delivered_order_items', { order_id: oid, item_ids: o.items.map((i: any) => i.item_id), payment_method_id: originalPm(o) })
    return say(`抱歉，操作没有成功：${last.out.replace(/^错误：/, '')}`)
  }
  if (last?.kind === 'call' && !last.ok && !last.name.startsWith('find_user')) return say(`抱歉，查询时出错了：${last.out.replace(/^错误：/, '')}`)

  // —— 身份验证 ——
  if (know.auth && !authUserId) {
    const id = latestIdentity(users)
    if (id) {
      const tried = calls.some((c) => c.name === id.tool && JSON.stringify(c.input) === JSON.stringify(id.input))
      if (!tried) return callTool(ctx, id.tool, id.input)
      return say(`没有找到${id.desc}对应的账户，请核对一下，或者换用姓名和邮编验证。`)
    }
    return say(ASK_IDENTITY)
  }
  if (know.auth && !userDetails && has('get_user_details')) return callTool(ctx, 'get_user_details', { user_id: authUserId })

  // —— 逐个处理客户的请求 ——
  const orderIds = [...new Set(users.flatMap((t) => t.match(/#?W\d{4}/g) ?? []).map(normId))]
  for (let i = 0; i < goal.length; i++) {
    const oid = orderIds[i]
    if (!oid) return say(i === 0 ? ASK_ORDER : ANYTHING_ELSE)
    const intent = goal[i]
    const done = calls.some((c) => c.ok && c.name === TOOL[intent.kind] && normId(String(c.input?.order_id)) === oid)
    const refused = ev.some((e) => e.kind === 'agent' && e.text.includes(oid.slice(1)) && /无法|不能/.test(e.text))
    if (done || refused) continue
    return handle(intent, oid)
  }
  return say(ANYTHING_ELSE)

  function handle(intent: Intent, oid: string) {
    const order = orders[oid]
    if (!order) return callTool(ctx, 'get_order_details', { order_id: oid })
    const need = NEED[intent.kind]
    if (know.rules) {
      if (know.auth && order.user_id !== authUserId) return say(`抱歉，订单 ${oid} 不属于您的账户，无法为您办理。`)
      if (order.status !== need.status)
        return say(
          `抱歉，订单 ${oid} 的状态是“${order.status_text}”，按照政策只有${need.text}的订单可以${need.verb}，无法为您办理。` +
            (intent.kind === 'cancel' && order.status === 'delivered' ? '如果需要，可以为您申请退货。' : ''),
        )
    }

    let args: Record<string, unknown>
    let summary: string
    const pay = () =>
      latestMatch<'gift' | 'orig'>(users, [
        [/礼品卡/, 'gift'],
        [/原来|原支付|原路/, 'orig'],
      ])
    const giftCard = () => userDetails?.payment_methods?.find((p: any) => p.source === 'gift_card')?.id as string | undefined

    if (intent.kind === 'cancel') {
      let reason = latestMatch(users, [
        [/误下单|下错|买错|拍错|手滑/, '误下单'],
        [/不再需要|不想要|不需要|用不上|不要了/, '不再需要'],
      ])
      if (!reason) {
        if (know.rules) return say(ASK_REASON)
        reason = '不再需要'
      }
      args = { order_id: oid, reason }
      summary = `取消订单 ${oid}（${itemNames(order)}），取消原因：${reason}，已付的 ${total(order)} 元将原路退回`
    } else if (intent.kind === 'address') {
      const hit = [...users]
        .reverse()
        .map((t) => t.match(/新地址是[：:]\s*(.+?)[，,]\s*邮编\s*(\d{6})/))
        .find(Boolean)
      if (!hit) return say(ASK_ADDRESS)
      args = { order_id: oid, address: hit[1], zip: hit[2] }
      summary = `把订单 ${oid} 的收货地址改为“${hit[1]}”，邮编 ${hit[2]}`
    } else if (intent.kind === 'return') {
      const its = order.items.filter((x: any) => intent.products!.some((p) => x.name.includes(p)))
      const p = pay()
      if (p === 'gift' && !giftCard()) return callTool(ctx, 'get_user_details', { user_id: order.user_id })
      if (!p && know.rules) return say(ASK_REFUND)
      const pm = p === 'gift' ? giftCard()! : originalPm(order)
      args = { order_id: oid, item_ids: its.map((x: any) => x.item_id), payment_method_id: pm }
      summary = `订单 ${oid} 退货：${its.map((x: any) => `${x.name}（${opts(x.options)}）`).join('、')}，退款 ${its.reduce((n: number, x: any) => n + x.price, 0)} 元退到 ${pm}`
    } else {
      const it = order.items.find((x: any) => x.name.includes(intent.product!))
      const product = products[it.product_id]
      if (!product) return callTool(ctx, 'get_product_details', { product_id: it.product_id })
      const target: Record<string, string> = { ...it.options, ...intent.change }
      const nv = product.variants.find((v: any) => v.available && Object.entries(target).every(([k, val]) => v.options[k] === val))
      if (!nv) return say(`抱歉，${product.name}（${opts(target)}）目前缺货，无法为您更换。`)
      const p = pay()
      if (p === 'gift' && !giftCard()) return callTool(ctx, 'get_user_details', { user_id: order.user_id })
      if (!p && know.rules) return say(ASK_PAY)
      const pm = p === 'gift' ? giftCard()! : originalPm(order)
      args = { order_id: oid, item_ids: [it.item_id], new_item_ids: [nv.item_id], payment_method_id: pm }
      summary = `${intent.kind === 'items' ? '修改' : '换货'}订单 ${oid}：${it.name}（${opts(it.options)}，${it.item_id}）换成（${opts(nv.options)}，${nv.item_id}），差价 ${nv.price - it.price} 元，用 ${pm} 结算`
    }

    if (know.confirm) {
      let ask = -1
      ev.forEach((e, idx) => {
        if (e.kind === 'agent' && e.text.includes(oid.slice(1)) && e.text.includes('请确认')) ask = idx
      })
      const confirmed = ask >= 0 && ev.slice(ask + 1).some((e) => e.kind === 'user' && isConfirm(e.text))
      if (!confirmed) return say(`请确认以下操作：${summary}。确认请回复“是”。`)
    }
    return callTool(ctx, TOOL[intent.kind], args)
  }
}

function originalPm(o: any): string {
  return o.payment_history.find((p: any) => p.type === 'payment').payment_method_id
}
function itemNames(o: any): string {
  return o.items.map((x: any) => `${x.name}（${opts(x.options)}）`).join('、')
}
function total(o: any): number {
  return o.items.reduce((n: number, x: any) => n + x.price, 0)
}

function doneText(tool: string, oid: string, input: any): string {
  switch (tool) {
    case 'cancel_pending_order':
      return `已为您取消订单 ${oid}，已付款项将原路退回。${ANYTHING_ELSE}`
    case 'modify_pending_order_address':
      return `已为您把订单 ${oid} 的收货地址改为 ${input.address}（邮编 ${input.zip}）。${ANYTHING_ELSE}`
    case 'modify_pending_order_items':
      return `已为您修改订单 ${oid} 的商品规格。${ANYTHING_ELSE}`
    case 'return_delivered_order_items':
      return `已为您提交订单 ${oid} 的退货申请，收到退货后退款将退到 ${input.payment_method_id}。${ANYTHING_ELSE}`
    case 'exchange_delivered_order_items':
      return `已为您提交订单 ${oid} 的换货申请。${ANYTHING_ELSE}`
    default:
      return `已为您办理完成。${ANYTHING_ELSE}`
  }
}
