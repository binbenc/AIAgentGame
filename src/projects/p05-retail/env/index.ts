/**
 * P5 的环境：一份全新的数据库 + 客服政策 + 现成的工具 + 模拟用户。
 * 和 τ-bench 一样，工具由环境提供；玩家负责把它们、政策和对话循环组装成一个可靠的客服 Agent。
 * 写操作会记录到 action log（发生在第几轮用户发言之后、当时验证的是谁），判定器据此检查流程是否合规。
 */
import type { ToolSpec } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { createSimUser, type SimUser, type SimUserSpec } from '../../usersim'
import type { EnvCtx } from '../../types'
import { freshDb, STATUS_TEXT, type Db } from './data'
import { CANCEL_REASONS, getOrder, getUser, normOrderId, WRITE_OPS } from './ops'
import { POLICY } from './policy'

/** 和工作区 tools.ts 里的 Tool 接口一致 */
export interface Tool {
  spec: ToolSpec
  run(input: any): unknown | Promise<unknown>
}

/** 交给玩家 serve() 的环境 */
export interface RetailEnv {
  user: SimUser
  tools: Tool[]
  policy: string
}

export interface ActionRecord {
  tool: string
  args: any
  /** 写操作发生时，用户已经说了几轮话（0 = 只有开场白） */
  turn: number
  /** 当时最近一条用户发言 */
  userText: string
  /** 用户这句话之前，客服说的最后一句话 */
  agentBefore: string
  /** 写操作发生时已经验证过的用户 id */
  authUserId: string | null
  /** 被操作的订单 / 账户属于谁 */
  ownerId: string
}

export interface EnvState {
  db: Db
  user: SimUser
  authUserId: string | null
  actions: ActionRecord[]
  transfers: { summary: string; turn: number }[]
}

const STATES = new WeakMap<RetailEnv, EnvState>()
export const stateOf = (env: RetailEnv): EnvState => STATES.get(env)!

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required }) as ToolSpec['input_schema']
const S = (description: string) => ({ type: 'string', description })
const LIST = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const CONFIRM_NOTE = L(
  '这是会修改数据的操作：调用前必须向用户列出操作详情，并得到用户明确确认（“是”）。',
  'This action changes data: before calling it, list the details to the user and get their explicit confirmation ("yes").',
)

const SPECS_ZH: ToolSpec[] = [
  { name: 'find_user_id_by_email', description: '根据邮箱查找用户 id，用于验证用户身份。找不到时报错。', input_schema: obj({ email: S('用户的注册邮箱，例如 someone@example.com') }, ['email']) },
  { name: 'find_user_id_by_name_zip', description: '根据姓名和邮编查找用户 id，用于验证用户身份（用户不记得邮箱时使用）。找不到时报错。', input_schema: obj({ name: S('用户姓名，例如 张伟'), zip: S('6 位邮编，例如 200001') }, ['name', 'zip']) },
  { name: 'get_user_details', description: '查询用户详情：姓名、邮箱、默认地址、支付方式（含礼品卡余额）、订单号列表。', input_schema: obj({ user_id: S('用户 id，例如 zhang_wei_1001') }, ['user_id']) },
  { name: 'get_order_details', description: '查询订单详情：状态、收货地址、商品（product_id、item_id、规格、价格）、支付记录、物流单号。', input_schema: obj({ order_id: S('订单号，例如 #W1001') }, ['order_id']) },
  { name: 'get_product_details', description: '查询商品详情：该商品的所有规格（item_id、规格选项、价格、是否有货 available）。', input_schema: obj({ product_id: S('商品 id，例如 8310') }, ['product_id']) },
  { name: 'list_all_product_types', description: '列出商城所有商品的名称和商品 id。', input_schema: obj({}, []) },
  { name: 'calculate', description: '计算一个数学表达式，例如 "459 - 399"。只支持数字、+ - * / 和括号。', input_schema: obj({ expression: S('数学表达式') }, ['expression']) },
  { name: 'cancel_pending_order', description: `取消一个待发货（pending）的订单，已付款项原路退回。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号，例如 #W1001'), reason: { type: 'string', enum: CANCEL_REASONS, description: '取消原因' } }, ['order_id', 'reason']) },
  { name: 'modify_pending_order_address', description: `修改待发货（pending）订单的收货地址。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号'), address: S('新的完整地址（省市区 + 街道门牌）'), zip: S('6 位邮编') }, ['order_id', 'address', 'zip']) },
  { name: 'modify_pending_order_items', description: `把待发货（pending）订单里的商品换成同一商品的其他有货规格。每个订单只能改一次，要改的商品必须在一次调用里全部给出。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号'), item_ids: LIST('要修改的原商品 item_id 列表'), new_item_ids: LIST('对应的新规格 item_id 列表，顺序与 item_ids 一一对应'), payment_method_id: S('结算差价用的支付方式 id（原支付方式或礼品卡）') }, ['order_id', 'item_ids', 'new_item_ids', 'payment_method_id']) },
  { name: 'modify_pending_order_payment', description: `把待发货（pending）订单的支付方式换成用户的另一种支付方式。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号'), payment_method_id: S('新的支付方式 id') }, ['order_id', 'payment_method_id']) },
  { name: 'return_delivered_order_items', description: `为已签收（delivered）订单申请退货。退款只能退到原支付方式或用户已有的礼品卡。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号'), item_ids: LIST('要退的商品 item_id 列表'), payment_method_id: S('接收退款的支付方式 id') }, ['order_id', 'item_ids', 'payment_method_id']) },
  { name: 'exchange_delivered_order_items', description: `为已签收（delivered）订单申请换货，只能换成同一商品的其他有货规格，要换的商品必须在一次调用里全部给出。${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('订单号'), item_ids: LIST('要换的原商品 item_id 列表'), new_item_ids: LIST('对应的新规格 item_id 列表'), payment_method_id: S('结算差价用的支付方式 id') }, ['order_id', 'item_ids', 'new_item_ids', 'payment_method_id']) },
  { name: 'modify_user_address', description: `修改用户账户的默认收货地址（不影响已有订单）。${CONFIRM_NOTE}`, input_schema: obj({ user_id: S('用户 id'), address: S('新的完整地址'), zip: S('6 位邮编') }, ['user_id', 'address', 'zip']) },
  { name: 'transfer_to_human_agents', description: '把对话转接给人工客服。只在用户的请求超出政策和工具的处理范围、且用户坚持时使用。', input_schema: obj({ summary: S('给人工客服的问题摘要') }, ['summary']) },
]

const SPECS_EN: ToolSpec[] = [
  { name: 'find_user_id_by_email', description: 'Find a user id by email, to verify the user\'s identity. Errors if not found.', input_schema: obj({ email: S('The user\'s account email, e.g. someone@example.com') }, ['email']) },
  { name: 'find_user_id_by_name_zip', description: 'Find a user id by name and zip code, to verify the user\'s identity (when they don\'t remember their email). Errors if not found.', input_schema: obj({ name: S('Full name, e.g. Zhang Wei'), zip: S('6-digit zip code, e.g. 200001') }, ['name', 'zip']) },
  { name: 'get_user_details', description: 'Get user details: name, email, default address, payment methods (including gift card balance), and order ids.', input_schema: obj({ user_id: S('User id, e.g. zhang_wei_1001') }, ['user_id']) },
  { name: 'get_order_details', description: 'Get order details: status, shipping address, items (product_id, item_id, options, price), payment history, tracking number.', input_schema: obj({ order_id: S('Order id, e.g. #W1001') }, ['order_id']) },
  { name: 'get_product_details', description: 'Get product details: all of its options (item_id, options, price, whether available).', input_schema: obj({ product_id: S('Product id, e.g. 8310') }, ['product_id']) },
  { name: 'list_all_product_types', description: 'List the names and product ids of all products in the store.', input_schema: obj({}, []) },
  { name: 'calculate', description: 'Evaluate a math expression, e.g. "459 - 399". Only numbers, + - * / and parentheses are supported.', input_schema: obj({ expression: S('Math expression') }, ['expression']) },
  { name: 'cancel_pending_order', description: `Cancel a pending order; the payment is refunded to the original method. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id, e.g. #W1001'), reason: { type: 'string', enum: CANCEL_REASONS, description: 'Reason for cancelling' } }, ['order_id', 'reason']) },
  { name: 'modify_pending_order_address', description: `Change the shipping address of a pending order. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id'), address: S('Full new address (street, district, city)'), zip: S('6-digit zip code') }, ['order_id', 'address', 'zip']) },
  { name: 'modify_pending_order_items', description: `Swap items in a pending order for other in-stock options of the same product. An order can only be modified once, so pass every item to change in a single call. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id'), item_ids: LIST('item_ids of the original items to change'), new_item_ids: LIST('item_ids of the new options, in the same order as item_ids'), payment_method_id: S('Payment method id that settles the price difference (the original method or a gift card)') }, ['order_id', 'item_ids', 'new_item_ids', 'payment_method_id']) },
  { name: 'modify_pending_order_payment', description: `Switch a pending order to another of the user's payment methods. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id'), payment_method_id: S('New payment method id') }, ['order_id', 'payment_method_id']) },
  { name: 'return_delivered_order_items', description: `Request a return for a delivered order. The refund can only go to the original payment method or the user's existing gift card. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id'), item_ids: LIST('item_ids of the items to return'), payment_method_id: S('Payment method id that receives the refund') }, ['order_id', 'item_ids', 'payment_method_id']) },
  { name: 'exchange_delivered_order_items', description: `Request an exchange for a delivered order. Items can only be exchanged for other in-stock options of the same product; pass every item to exchange in a single call. ${CONFIRM_NOTE}`, input_schema: obj({ order_id: S('Order id'), item_ids: LIST('item_ids of the original items to exchange'), new_item_ids: LIST('item_ids of the new options'), payment_method_id: S('Payment method id that settles the price difference') }, ['order_id', 'item_ids', 'new_item_ids', 'payment_method_id']) },
  { name: 'modify_user_address', description: `Change the default shipping address on the user's account (existing orders are not affected). ${CONFIRM_NOTE}`, input_schema: obj({ user_id: S('User id'), address: S('Full new address'), zip: S('6-digit zip code') }, ['user_id', 'address', 'zip']) },
  { name: 'transfer_to_human_agents', description: 'Transfer the conversation to a human agent. Only use it when the user\'s request is beyond the policy and the tools, and the user insists.', input_schema: obj({ summary: S('Summary of the issue for the human agent') }, ['summary']) },
]

const SPECS = L(SPECS_ZH, SPECS_EN)

const withStatus = <T extends { status: keyof typeof STATUS_TEXT }>(o: T) => ({ ...o, status_text: STATUS_TEXT[o.status] })

export function createRetailEnv(spec: SimUserSpec, ctx: EnvCtx): RetailEnv {
  const user = createSimUser(spec, ctx)
  const state: EnvState = { db: freshDb(), user, authUserId: null, actions: [], transfers: [] }
  const { db } = state

  const authenticate = (id: string) => {
    state.authUserId = id
    return id
  }
  const reads: Record<string, (input: any) => unknown> = {
    find_user_id_by_email: (i) => {
      const email = String(i?.email ?? '').trim().toLowerCase()
      const u = Object.values(db.users).find((x) => x.email === email)
      if (!u) throw new Error(L(`没有找到邮箱为 ${email || '（空）'} 的用户`, `No user found with email ${email || '(empty)'}`))
      return authenticate(u.user_id)
    },
    find_user_id_by_name_zip: (i) => {
      const name = String(i?.name ?? '').replace(/\s/g, '')
      const zip = String(i?.zip ?? '').trim()
      // 比较时忽略空白和大小写（英文名 "Li Na" / "li na" / "LiNa" 都算）
      const key = (s: string) => s.replace(/\s/g, '').toLowerCase()
      const u = Object.values(db.users).find((x) => key(x.name) === key(name) && x.address.zip === zip)
      if (!u) throw new Error(L(`没有找到姓名为 ${name || '（空）'}、邮编为 ${zip || '（空）'} 的用户`, `No user found with name ${String(i?.name ?? '').trim() || '(empty)'} and zip ${zip || '(empty)'}`))
      return authenticate(u.user_id)
    },
    get_user_details: (i) => structuredClone(getUser(db, i?.user_id)),
    get_order_details: (i) => structuredClone(withStatus(getOrder(db, i?.order_id))),
    get_product_details: (i) => {
      const id = String(i?.product_id ?? '').trim()
      const p = db.products[id]
      if (!p) throw new Error(L(`商品 ${id} 不存在（product_id 是 4 位数字，可以从订单详情里的商品信息找到）`, `Product ${id} not found (product_id is a 4-digit number; you can find it in the items of the order details)`))
      return structuredClone(p)
    },
    list_all_product_types: () => Object.fromEntries(Object.values(db.products).map((p) => [p.name, p.product_id])),
    calculate: (i) => {
      const expr = String(i?.expression ?? '')
      if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error(L('表达式只能包含数字、+ - * / 和括号', 'The expression may only contain numbers, + - * / and parentheses'))
      const v = Function(`"use strict"; return (${expr})`)() as number
      if (!Number.isFinite(v)) throw new Error(L('计算结果无效', 'Invalid result'))
      return Math.round(v * 100) / 100
    },
    transfer_to_human_agents: (i) => {
      state.transfers.push({ summary: String(i?.summary ?? ''), turn: currentTurn() })
      return L('已转接人工客服。请告诉用户：已为您转接人工客服，请稍候。', 'Transferred to a human agent. Tell the user: "I\'ve transferred you to a human agent; please hold on."')
    },
  }

  function currentTurn() {
    return user.transcript.filter((m) => m.role === 'user').length - 1
  }

  function write(name: string, input: any) {
    // 先确定被操作对象的归属（不存在时让操作本身报错）
    let ownerId = ''
    try {
      ownerId = name === 'modify_user_address' ? getUser(db, input?.user_id).user_id : getOrder(db, input?.order_id).user_id
    } catch {
      /* 交给操作本身报错 */
    }
    const out = WRITE_OPS[name](db, input)
    const t = user.transcript
    const lastUser = t.map((m, i) => [m, i] as const).filter(([m]) => m.role === 'user').pop()!
    const before = t.slice(0, lastUser[1]).filter((m) => m.role === 'agent').pop()
    const args = structuredClone(input)
    if (args?.order_id) args.order_id = normOrderId(String(args.order_id))
    state.actions.push({ tool: name, args, turn: currentTurn(), userText: lastUser[0].text, agentBefore: before?.text ?? '', authUserId: state.authUserId, ownerId })
    return out
  }

  const tools: Tool[] = SPECS.map((spec) => {
    const impl = reads[spec.name] ?? ((input: any) => write(spec.name, input))
    return {
      spec,
      run: ctx.traced(spec.name, async (input: any) => {
        await ctx.delay(WRITE_OPS[spec.name] ? 120 : 60)
        return impl(input)
      }),
    }
  })

  const env: RetailEnv = { user, tools, policy: POLICY }
  STATES.set(env, state)
  return env
}
