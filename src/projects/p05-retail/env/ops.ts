/**
 * 数据库操作的纯函数实现。环境里的工具和判定器（计算“期望的最终状态”）用的是同一套实现。
 * 非法操作一律抛出带中文说明的 Error（工具会把它作为 is_error 结果交给模型）。
 */
import { STATUS_TEXT, type Db, type Order, type PaymentMethod, type User } from './data'

const fail = (msg: string): never => {
  throw new Error(msg)
}

const str = (v: unknown, field: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fail(`参数 ${field} 必须是非空字符串`))
const strList = (v: unknown, field: string): string[] =>
  Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? (v as string[]).map((x) => x.trim()) : fail(`参数 ${field} 必须是非空的字符串数组`)

/** 订单号允许省略开头的 # */
export const normOrderId = (id: string) => (id.startsWith('#') ? id : `#${id}`)
const normAddress = (s: string) => s.replace(/[\s，,。]/g, '')

export function getUser(db: Db, userId: unknown): User {
  const id = str(userId, 'user_id')
  return db.users[id] ?? fail(`用户 ${id} 不存在`)
}

export function getOrder(db: Db, orderId: unknown): Order {
  const id = normOrderId(str(orderId, 'order_id'))
  return db.orders[id] ?? fail(`订单 ${id} 不存在`)
}

function requireStatus(o: Order, status: Order['status'], what: string) {
  if (o.status !== status)
    fail(`订单 ${o.order_id} 的状态是“${STATUS_TEXT[o.status]}”（${o.status}），只有${STATUS_TEXT[status]}（${status}）的订单可以${what}`)
}

function paymentMethodOf(db: Db, o: Order, id: unknown): PaymentMethod {
  const pmId = str(id, 'payment_method_id')
  const pm = db.users[o.user_id].payment_methods.find((p) => p.id === pmId)
  return pm ?? fail(`支付方式 ${pmId} 不属于订单 ${o.order_id} 的下单用户`)
}

const originalMethods = (o: Order) => [...new Set(o.payment_history.filter((p) => p.type === 'payment').map((p) => p.payment_method_id))]

/** 按支付方式统计净付款（付款 - 退款） */
function netPaid(o: Order): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of o.payment_history) m.set(p.payment_method_id, (m.get(p.payment_method_id) ?? 0) + (p.type === 'payment' ? p.amount : -p.amount))
  return m
}

function adjustGiftCard(db: Db, o: Order, pmId: string, delta: number) {
  const pm = db.users[o.user_id].payment_methods.find((p) => p.id === pmId)
  if (pm?.source === 'gift_card') pm.balance = (pm.balance ?? 0) + delta
}

/** 校验“同商品、换规格”：返回新旧规格对和差价 */
function swapPlan(db: Db, o: Order, itemIds: string[], newItemIds: string[]) {
  if (itemIds.length !== newItemIds.length) fail(`item_ids（${itemIds.length} 个）和 new_item_ids（${newItemIds.length} 个）数量必须一致，一一对应`)
  if (new Set(itemIds).size !== itemIds.length) fail('item_ids 里有重复的商品')
  let diff = 0
  const pairs = itemIds.map((id, i) => {
    const old = o.items.find((it) => it.item_id === id) ?? fail(`订单 ${o.order_id} 里没有 item_id 为 ${id} 的商品`)
    const product = db.products[old.product_id]
    const nv = product.variants.find((v) => v.item_id === newItemIds[i])
    if (!nv) {
      const other = Object.values(db.products).find((p) => p.variants.some((v) => v.item_id === newItemIds[i]))
      fail(other ? `只能换成同一商品（${product.name}）的其他规格，不能换成${other.name}（${newItemIds[i]}）` : `商品规格 ${newItemIds[i]} 不存在`)
    }
    if (nv!.item_id === id) fail(`新规格 ${nv!.item_id} 和原规格相同`)
    if (!nv!.available) fail(`${product.name}（${Object.values(nv!.options).join('/')}，${nv!.item_id}）目前缺货，不能换成这个规格`)
    diff += nv!.price - old.price
    return { old, nv: nv! }
  })
  return { pairs, diff }
}

// —————————— 写操作 ——————————

export const CANCEL_REASONS = ['不再需要', '误下单']

export function cancelPendingOrder(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  const reason = str(input?.reason, 'reason')
  if (!CANCEL_REASONS.includes(reason)) fail(`取消原因只能是“不再需要”或“误下单”，收到的是“${reason}”`)
  requireStatus(o, 'pending', '取消')
  for (const [pm, amount] of netPaid(o))
    if (amount > 0) {
      o.payment_history.push({ type: 'refund', amount, payment_method_id: pm })
      adjustGiftCard(db, o, pm, amount)
    }
  o.status = 'cancelled'
  o.cancel_reason = reason
  return { ...o, status_text: STATUS_TEXT[o.status] }
}

export function modifyPendingOrderAddress(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  const address = normAddress(str(input?.address, 'address'))
  const zip = str(input?.zip, 'zip')
  if (!/^\d{6}$/.test(zip)) fail(`邮编必须是 6 位数字，收到的是“${zip}”`)
  requireStatus(o, 'pending', '修改收货地址')
  o.address = { address, zip }
  return { ...o, status_text: STATUS_TEXT[o.status] }
}

export function modifyPendingOrderItems(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  const itemIds = strList(input?.item_ids, 'item_ids')
  const newIds = strList(input?.new_item_ids, 'new_item_ids')
  requireStatus(o, 'pending', '修改商品')
  if (o.items_modified) fail(`订单 ${o.order_id} 的商品已经修改过一次，不能再次修改`)
  const pm = paymentMethodOf(db, o, input?.payment_method_id)
  const { pairs, diff } = swapPlan(db, o, itemIds, newIds)
  if (pm.source === 'gift_card' && diff > (pm.balance ?? 0)) fail(`礼品卡余额 ${pm.balance} 元，不足以支付差价 ${diff} 元`)
  for (const { old, nv } of pairs) Object.assign(old, { item_id: nv.item_id, options: { ...nv.options }, price: nv.price })
  if (diff !== 0) {
    o.payment_history.push({ type: diff > 0 ? 'payment' : 'refund', amount: Math.abs(diff), payment_method_id: pm.id })
    adjustGiftCard(db, o, pm.id, -diff)
  }
  o.items_modified = true
  return { ...o, status_text: STATUS_TEXT[o.status], price_difference: diff }
}

export function modifyPendingOrderPayment(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  requireStatus(o, 'pending', '修改支付方式')
  const pm = paymentMethodOf(db, o, input?.payment_method_id)
  const paid = [...netPaid(o)].filter(([, n]) => n > 0)
  if (paid.length !== 1) fail(`订单 ${o.order_id} 有多笔支付记录，无法修改支付方式`)
  const [oldId, total] = paid[0]
  if (oldId === pm.id) fail(`订单 ${o.order_id} 已经在用 ${pm.id} 支付，新支付方式必须不同`)
  if (pm.source === 'gift_card' && total > (pm.balance ?? 0)) fail(`礼品卡余额 ${pm.balance} 元，不足以支付订单金额 ${total} 元`)
  o.payment_history.push({ type: 'payment', amount: total, payment_method_id: pm.id }, { type: 'refund', amount: total, payment_method_id: oldId })
  adjustGiftCard(db, o, pm.id, -total)
  adjustGiftCard(db, o, oldId, total)
  return { ...o, status_text: STATUS_TEXT[o.status] }
}

export function returnDeliveredOrderItems(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  const itemIds = strList(input?.item_ids, 'item_ids')
  requireStatus(o, 'delivered', '退货')
  const pm = paymentMethodOf(db, o, input?.payment_method_id)
  if (!originalMethods(o).includes(pm.id) && pm.source !== 'gift_card')
    fail(`退款只能退到原支付方式（${originalMethods(o).join('、')}）或客户已有的礼品卡，不能退到 ${pm.id}`)
  if (new Set(itemIds).size !== itemIds.length) fail('item_ids 里有重复的商品')
  for (const id of itemIds) if (!o.items.some((it) => it.item_id === id)) fail(`订单 ${o.order_id} 里没有 item_id 为 ${id} 的商品`)
  o.status = 'return requested'
  o.return = { item_ids: itemIds, payment_method_id: pm.id }
  return { ...o, status_text: STATUS_TEXT[o.status] }
}

export function exchangeDeliveredOrderItems(db: Db, input: any) {
  const o = getOrder(db, input?.order_id)
  const itemIds = strList(input?.item_ids, 'item_ids')
  const newIds = strList(input?.new_item_ids, 'new_item_ids')
  requireStatus(o, 'delivered', '换货')
  const pm = paymentMethodOf(db, o, input?.payment_method_id)
  const { diff } = swapPlan(db, o, itemIds, newIds)
  if (pm.source === 'gift_card' && diff > (pm.balance ?? 0)) fail(`礼品卡余额 ${pm.balance} 元，不足以支付差价 ${diff} 元`)
  o.status = 'exchange requested'
  o.exchange = { item_ids: itemIds, new_item_ids: newIds, payment_method_id: pm.id, price_difference: diff }
  return { ...o, status_text: STATUS_TEXT[o.status] }
}

export function modifyUserAddress(db: Db, input: any) {
  const u = getUser(db, input?.user_id)
  const address = normAddress(str(input?.address, 'address'))
  const zip = str(input?.zip, 'zip')
  if (!/^\d{6}$/.test(zip)) fail(`邮编必须是 6 位数字，收到的是“${zip}”`)
  u.address = { address, zip }
  return u
}

/** 会修改数据库的操作 */
export const WRITE_OPS: Record<string, (db: Db, input: any) => unknown> = {
  cancel_pending_order: cancelPendingOrder,
  modify_pending_order_address: modifyPendingOrderAddress,
  modify_pending_order_items: modifyPendingOrderItems,
  modify_pending_order_payment: modifyPendingOrderPayment,
  return_delivered_order_items: returnDeliveredOrderItems,
  exchange_delivered_order_items: exchangeDeliveredOrderItems,
  modify_user_address: modifyUserAddress,
}
