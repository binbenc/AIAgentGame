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
import { L } from '../../engine/locale'
import { CANCEL_REASONS } from './env/ops'
import { isConfirm } from './tasks'

type Kind = 'cancel' | 'address' | 'items' | 'return' | 'exchange'
type Intent = { kind: Kind; product?: string; change?: Record<string, string>; products?: string[] }

const GOALS: Record<string, Intent[]> = {
  'cancel-pending': [{ kind: 'cancel' }],
  'modify-address': [{ kind: 'address' }],
  'modify-items': [{ kind: 'items', product: L('T恤', 'T-Shirt'), change: L<Record<string, string>>({ 尺码: 'L' }, { size: 'L' }) }],
  'return-giftcard': [{ kind: 'return', products: [L('台灯', 'Lamp')] }],
  'exchange-size': [{ kind: 'exchange', product: L('跑步鞋', 'Running Shoes'), change: L<Record<string, string>>({ 尺码: '42' }, { size: '42' }) }],
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
const NEED: Record<Kind, { status: string; text: string; verb: string }> = L(
  {
    cancel: { status: 'pending', text: '待发货', verb: '取消' },
    address: { status: 'pending', text: '待发货', verb: '修改收货地址' },
    items: { status: 'pending', text: '待发货', verb: '修改商品' },
    return: { status: 'delivered', text: '已签收', verb: '退货' },
    exchange: { status: 'delivered', text: '已签收', verb: '换货' },
  },
  {
    cancel: { status: 'pending', text: 'pending', verb: 'cancelled' },
    address: { status: 'pending', text: 'pending', verb: 'given a new shipping address' },
    items: { status: 'pending', text: 'pending', verb: 'modified' },
    return: { status: 'delivered', text: 'delivered', verb: 'returned' },
    exchange: { status: 'delivered', text: 'delivered', verb: 'exchanged' },
  },
)

// system 里能看出哪些政策（中英文的说法都认，不随界面语言变化）
const AUTH_RE =
  /验证.{0,10}身份|身份.{0,4}验证|核实.{0,6}身份|(verify|verifies|verifying|verified|authenticate|confirm|check).{0,30}(identity|who (they are|the (customer|user) is))|identity.{0,20}(verif|check|authenticat)|authenticate (the )?(user|customer)/i
const CONFIRM_RE =
  /(明确|得到|获得|等待).{0,10}确认|确认.{0,10}(之后|以后|后再|后才|才能)|explicit(ly)? (confirm|confirmation|approv|consent|yes)|(get|obtain|wait for|receive|ask for|require|need)s?.{0,30}(confirmation|consent|approval|to confirm)|(until|after|once) (the )?(customer|user) (has )?(confirm|approv|agree|says? "?yes)|confirm.{0,30}before/i
const RULES_RE = [/待发货|pending/, /已签收|delivered/]

const ASK_IDENTITY = L(
  '您好！为了保护您的账户安全，办理业务前需要先验证您的身份：请提供注册邮箱，或者姓名和邮编。',
  "Hi! To keep your account safe, I need to verify your identity first: please give me your account email, or your full name and zip code.",
)
const ASK_ORDER = L('好的，请问是哪个订单？请提供订单号（例如 #W1234）。', 'Sure. Which order is this about? Please give me the order number (e.g. #W1234).')
const ASK_REASON = L('请问取消的原因是“不再需要”还是“误下单”？', 'What is the reason for cancelling: "no longer needed" or "ordered by mistake"?')
const ASK_ADDRESS = L('请提供新的收货地址和邮编。', 'Please give me the new shipping address and zip code.')
const ASK_PAY = L('差价（如有）用哪种支付方式结算？可以用原支付方式或您账户里的礼品卡。', 'Which payment method should cover the price difference, if any: the original one or the gift card on your account?')
const ASK_REFUND = L('退款退到原支付方式，还是退到您的礼品卡？', 'Should the refund go to the original payment method or to your gift card?')
const ANYTHING_ELSE = L('还有其他可以帮您的吗？', 'Is there anything else I can help you with?')
const [NO_NEED, MISTAKE] = CANCEL_REASONS
const SEP = L('、', ', ')

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
    if (email) return { tool: 'find_user_id_by_email', input: { email: email[0] }, desc: L(`邮箱 ${email[0]} `, `email ${email[0]}`) }
    const name = t.match(/我叫([一-龥]{2,3})/) ?? t.match(/[Mm]y name is ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/)
    const zip = t.match(/邮编\s*(?:是)?\s*(\d{6})/) ?? t.match(/zip(?: code)?(?: is)?[\s:]*(\d{6})/i)
    if (name && zip) return { tool: 'find_user_id_by_name_zip', input: { name: name[1], zip: zip[1] }, desc: L(`姓名 ${name[1]}、邮编 ${zip[1]} `, `name ${name[1]} and zip ${zip[1]}`) }
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
  if (!has('get_order_details')) return say(L('抱歉，我这边暂时查不到订单系统，请稍后再试。', "Sorry, I can't reach the order system right now. Please try again later."))

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
    return say(L(`抱歉，操作没有成功：${errText(last.out)}`, `Sorry, that didn't go through: ${errText(last.out)}`))
  }
  if (last?.kind === 'call' && !last.ok && !last.name.startsWith('find_user'))
    return say(L(`抱歉，查询时出错了：${errText(last.out)}`, `Sorry, something went wrong with the lookup: ${errText(last.out)}`))

  // —— 身份验证 ——
  if (know.auth && !authUserId) {
    const id = latestIdentity(users)
    if (id) {
      const tried = calls.some((c) => c.name === id.tool && JSON.stringify(c.input) === JSON.stringify(id.input))
      if (!tried) return callTool(ctx, id.tool, id.input)
      return say(L(`没有找到${id.desc}对应的账户，请核对一下，或者换用姓名和邮编验证。`, `I couldn't find an account for ${id.desc}. Please double-check it, or verify with your name and zip code instead.`))
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
    const refused = ev.some((e) => e.kind === 'agent' && e.text.includes(oid.slice(1)) && /无法|不能|can't|cannot|unable/i.test(e.text))
    if (done || refused) continue
    return handle(intent, oid)
  }
  return say(ANYTHING_ELSE)

  function handle(intent: Intent, oid: string) {
    const order = orders[oid]
    if (!order) return callTool(ctx, 'get_order_details', { order_id: oid })
    const need = NEED[intent.kind]
    if (know.rules) {
      if (know.auth && order.user_id !== authUserId)
        return say(L(`抱歉，订单 ${oid} 不属于您的账户，无法为您办理。`, `Sorry, order ${oid} isn't on your account, so I can't help with it.`))
      if (order.status !== need.status)
        return say(
          L(
            `抱歉，订单 ${oid} 的状态是“${order.status_text}”，按照政策只有${need.text}的订单可以${need.verb}，无法为您办理。`,
            `Sorry, order ${oid} is ${order.status_text}. Under our policy only ${need.text} orders can be ${need.verb}, so I can't do that.`,
          ) + (intent.kind === 'cancel' && order.status === 'delivered' ? L('如果需要，可以为您申请退货。', ' If you like, I can start a return instead.') : ''),
        )
    }

    let args: Record<string, unknown>
    let summary: string
    const pay = () =>
      latestMatch<'gift' | 'orig'>(users, [
        [/礼品卡|gift card/i, 'gift'],
        [/原来|原支付|原路|original|same (card|payment|method|account)/i, 'orig'],
      ])
    const giftCard = () => userDetails?.payment_methods?.find((p: any) => p.source === 'gift_card')?.id as string | undefined

    if (intent.kind === 'cancel') {
      let reason = latestMatch(users, [
        [/误下单|下错|买错|拍错|手滑|by mistake|mistakenly|by accident|accidentally|wrong order/i, MISTAKE],
        [/不再需要|不想要|不需要|用不上|不要了|no longer need|don't need|don't want|not needed|no use for/i, NO_NEED],
      ])
      if (!reason) {
        if (know.rules) return say(ASK_REASON)
        reason = NO_NEED
      }
      args = { order_id: oid, reason }
      summary = L(
        `取消订单 ${oid}（${itemNames(order)}），取消原因：${reason}，已付的 ${total(order)} 元将原路退回`,
        `cancel order ${oid} (${itemNames(order)}), reason: ${reason}; the ¥${total(order)} you paid will be refunded to the original payment method`,
      )
    } else if (intent.kind === 'address') {
      const hit = [...users]
        .reverse()
        .map((t) => t.match(/新地址是[：:]\s*(.+?)[，,]\s*邮编\s*(\d{6})/) ?? t.match(/new address is[:：]?\s*(.+?)[,，]\s*zip(?: code)?(?: is)?[\s:]*(\d{6})/i))
        .find(Boolean)
      if (!hit) return say(ASK_ADDRESS)
      args = { order_id: oid, address: hit[1], zip: hit[2] }
      summary = L(`把订单 ${oid} 的收货地址改为“${hit[1]}”，邮编 ${hit[2]}`, `change the shipping address of order ${oid} to "${hit[1]}", zip code ${hit[2]}`)
    } else if (intent.kind === 'return') {
      const its = order.items.filter((x: any) => intent.products!.some((p) => x.name.includes(p)))
      const p = pay()
      if (p === 'gift' && !giftCard()) return callTool(ctx, 'get_user_details', { user_id: order.user_id })
      if (!p && know.rules) return say(ASK_REFUND)
      const pm = p === 'gift' ? giftCard()! : originalPm(order)
      args = { order_id: oid, item_ids: its.map((x: any) => x.item_id), payment_method_id: pm }
      const refund = its.reduce((n: number, x: any) => n + x.price, 0)
      summary = L(
        `订单 ${oid} 退货：${its.map((x: any) => `${x.name}（${opts(x.options)}）`).join('、')}，退款 ${refund} 元退到 ${pm}`,
        `return from order ${oid}: ${its.map((x: any) => `${x.name} (${opts(x.options)})`).join(', ')}; refund of ¥${refund} to ${pm}`,
      )
    } else {
      const it = order.items.find((x: any) => x.name.toLowerCase().includes(intent.product!.toLowerCase()))
      const product = products[it.product_id]
      if (!product) return callTool(ctx, 'get_product_details', { product_id: it.product_id })
      const target: Record<string, string> = { ...it.options, ...intent.change }
      const nv = product.variants.find((v: any) => v.available && Object.entries(target).every(([k, val]) => v.options[k] === val))
      if (!nv) return say(L(`抱歉，${product.name}（${opts(target)}）目前缺货，无法为您更换。`, `Sorry, ${product.name} (${opts(target)}) is out of stock, so I can't make that change.`))
      const p = pay()
      if (p === 'gift' && !giftCard()) return callTool(ctx, 'get_user_details', { user_id: order.user_id })
      if (!p && know.rules) return say(ASK_PAY)
      const pm = p === 'gift' ? giftCard()! : originalPm(order)
      args = { order_id: oid, item_ids: [it.item_id], new_item_ids: [nv.item_id], payment_method_id: pm }
      summary = L(
        `${intent.kind === 'items' ? '修改' : '换货'}订单 ${oid}：${it.name}（${opts(it.options)}，${it.item_id}）换成（${opts(nv.options)}，${nv.item_id}），差价 ${nv.price - it.price} 元，用 ${pm} 结算`,
        `${intent.kind === 'items' ? 'modify' : 'exchange'} order ${oid}: ${it.name} (${opts(it.options)}, ${it.item_id}) → (${opts(nv.options)}, ${nv.item_id}); price difference ¥${nv.price - it.price}, settled with ${pm}`,
      )
    }

    if (know.confirm) {
      let ask = -1
      ev.forEach((e, idx) => {
        if (e.kind === 'agent' && e.text.includes(oid.slice(1)) && (e.text.includes('请确认') || /please confirm/i.test(e.text))) ask = idx
      })
      const confirmed = ask >= 0 && ev.slice(ask + 1).some((e) => e.kind === 'user' && isConfirm(e.text))
      if (!confirmed) return say(L(`请确认以下操作：${summary}。确认请回复“是”。`, `Please confirm the following: ${summary}. Reply "yes" to confirm.`))
    }
    return callTool(ctx, TOOL[intent.kind], args)
  }
}

function originalPm(o: any): string {
  return o.payment_history.find((p: any) => p.type === 'payment').payment_method_id
}
function itemNames(o: any): string {
  return o.items.map((x: any) => L(`${x.name}（${opts(x.options)}）`, `${x.name} (${opts(x.options)})`)).join(SEP)
}
/** 工具报错的内容（去掉开头的“错误：”/“Error:”） */
const errText = (out: string) => out.replace(/^(错误：|Error:\s*)/, '')
function total(o: any): number {
  return o.items.reduce((n: number, x: any) => n + x.price, 0)
}

function doneText(tool: string, oid: string, input: any): string {
  switch (tool) {
    case 'cancel_pending_order':
      return L(`已为您取消订单 ${oid}，已付款项将原路退回。${ANYTHING_ELSE}`, `I've cancelled order ${oid}; your payment will be refunded to the original method. ${ANYTHING_ELSE}`)
    case 'modify_pending_order_address':
      return L(`已为您把订单 ${oid} 的收货地址改为 ${input.address}（邮编 ${input.zip}）。${ANYTHING_ELSE}`, `I've changed the shipping address of order ${oid} to ${input.address} (zip code ${input.zip}). ${ANYTHING_ELSE}`)
    case 'modify_pending_order_items':
      return L(`已为您修改订单 ${oid} 的商品规格。${ANYTHING_ELSE}`, `I've updated the items in order ${oid}. ${ANYTHING_ELSE}`)
    case 'return_delivered_order_items':
      return L(`已为您提交订单 ${oid} 的退货申请，收到退货后退款将退到 ${input.payment_method_id}。${ANYTHING_ELSE}`, `I've submitted the return for order ${oid}; once we receive it, the refund will go to ${input.payment_method_id}. ${ANYTHING_ELSE}`)
    case 'exchange_delivered_order_items':
      return L(`已为您提交订单 ${oid} 的换货申请。${ANYTHING_ELSE}`, `I've submitted the exchange for order ${oid}. ${ANYTHING_ELSE}`)
    default:
      return L(`已为您办理完成。${ANYTHING_ELSE}`, `All done. ${ANYTHING_ELSE}`)
  }
}
