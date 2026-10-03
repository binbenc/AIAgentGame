/**
 * P5 任务集：每个任务 = 一位客户（模拟用户）+ 期望的写操作列表。
 * 判定（与模型无关，τ-bench 的做法）：
 *   1. 流程合规：写操作前已验证身份、只操作本人数据、每个写操作前客户明确确认过、一次确认只对应一个操作；
 *   2. 结果正确：把期望的写操作作用在初始数据库上，得到期望的最终状态，和实际最终状态逐字段比较；
 *   3. 需要转人工 / 需要告诉客户某个信息的任务，额外检查对应结果。
 */
import { STOP, type SimUserSpec } from '../usersim'
import type { CheckResult, ProjectTask } from '../types'
import { freshDb, STATUS_TEXT, type Db, type Order } from './env/data'
import { stateOf, type ActionRecord, type RetailEnv } from './env/index'
import { WRITE_OPS } from './env/ops'

export interface Action {
  tool: string
  args: Record<string, unknown>
}

/** 模拟模式下的客户脚本（只有核心任务需要） */
export interface ScriptSpec {
  /** 被问到身份时怎么说 */
  identity: string
  /** 第一次被问到身份时先说错的信息（之后会更正） */
  wrongIdentity?: string
  requests: {
    orderId: string
    /** 第二个及以后的请求：上一个办完后客户怎么提出来 */
    intro?: string
    /** 被问到订单号时怎么说 */
    orderText?: string
    /** 被问到取消原因 / 新地址 / 支付方式时怎么说 */
    reason?: string
    address?: string
    payment?: string
  }[]
  /** 客服拒绝办理时客户怎么说 */
  onRefusal?: string
}

export interface RetailTaskSpec {
  id: string
  title: string
  core: boolean
  opening: string
  /** 真实模式下模拟用户的人设 */
  instruction: string
  script?: ScriptSpec
  /** 期望的写操作（包括 transfer_to_human_agents）；空数组表示按政策不应修改任何数据 */
  expected: Action[]
  /** 不应修改数据时的原因（用于失败提示） */
  why?: string
  /** 客服必须告诉客户的信息 */
  mustSay?: string[]
}

const cancel = (order_id: string, reason: string): Action => ({ tool: 'cancel_pending_order', args: { order_id, reason } })
const address = (order_id: string, addr: string, zip: string): Action => ({ tool: 'modify_pending_order_address', args: { order_id, address: addr, zip } })
const items = (order_id: string, item_ids: string[], new_item_ids: string[], payment_method_id: string): Action => ({ tool: 'modify_pending_order_items', args: { order_id, item_ids, new_item_ids, payment_method_id } })
const payment = (order_id: string, payment_method_id: string): Action => ({ tool: 'modify_pending_order_payment', args: { order_id, payment_method_id } })
const ret = (order_id: string, item_ids: string[], payment_method_id: string): Action => ({ tool: 'return_delivered_order_items', args: { order_id, item_ids, payment_method_id } })
const exchange = (order_id: string, item_ids: string[], new_item_ids: string[], payment_method_id: string): Action => ({ tool: 'exchange_delivered_order_items', args: { order_id, item_ids, new_item_ids, payment_method_id } })
const transfer: Action = { tool: 'transfer_to_human_agents', args: {} }

const PERSONA = '客服要求验证身份时提供上面的身份信息。客服列出操作详情请你确认时，核对无误就明确回复“是的，确认”。'

export const TASK_SPECS: RetailTaskSpec[] = [
  // ———————————— 核心任务（模拟模型可解，参与评星） ————————————
  {
    id: 'cancel-pending',
    title: '取消待发货订单',
    core: true,
    opening: '你好，我想取消一个还没发货的订单。',
    instruction: `你叫张伟，注册邮箱 zhangwei@example.com。你想取消订单 #W1001（一副白色降噪蓝牙耳机），原因是不再需要了。${PERSONA}办完后道谢并结束对话。`,
    script: { identity: '我的邮箱是 zhangwei@example.com。', requests: [{ orderId: '#W1001', orderText: '订单号是 #W1001，那副蓝牙耳机我不想要了。', reason: '不再需要了。' }] },
    expected: [cancel('#W1001', '不再需要')],
  },
  {
    id: 'modify-address',
    title: '修改收货地址（姓名 + 邮编验证）',
    core: true,
    opening: '我下单时地址填错了，想改一下收货地址。',
    instruction: `你叫李娜，邮编 100020，你不记得注册邮箱了，只能用姓名和邮编验证。你想把待发货订单 #W1004 的收货地址改成：北京市海淀区中关村大街27号，邮编 100080。${PERSONA}办完后结束对话。`,
    script: {
      identity: '我不记得邮箱了。我叫李娜，邮编 100020。',
      requests: [{ orderId: '#W1004', address: '新地址是：北京市海淀区中关村大街27号，邮编 100080。' }],
    },
    expected: [address('#W1004', '北京市海淀区中关村大街27号', '100080')],
  },
  {
    id: 'modify-items',
    title: '待发货订单改尺码',
    core: true,
    opening: '我有个订单还没发货，想把里面的T恤换成 L 码，颜色不变。',
    instruction: `你叫王芳，注册邮箱 wangfang@example.com。你的待发货订单 #W1005 里有一件黑色 M 码的纯棉T恤，你想换成黑色 L 码，订单里的双肩包不变。差价（如果有）用原来的信用卡结算。${PERSONA}办完后结束对话。`,
    script: {
      identity: '邮箱是 wangfang@example.com。',
      requests: [{ orderId: '#W1005', payment: '差价就用原来的信用卡付吧。' }],
    },
    expected: [items('#W1005', ['2103'], ['2104'], 'credit_card_1003')],
  },
  {
    id: 'return-giftcard',
    title: '退货退到礼品卡',
    core: true,
    opening: '我收到的台灯不想要了，想退货。',
    instruction: `你叫陈静，注册邮箱 chenjing@example.com。已签收的订单 #W1006 里有一个白色护眼台灯和一副耳机，你只想退台灯，耳机留着。退款退到你的礼品卡。${PERSONA}办完后结束对话。`,
    script: {
      identity: '我的邮箱：chenjing@example.com',
      requests: [{ orderId: '#W1006', payment: '退款请退到我的礼品卡里。' }],
    },
    expected: [ret('#W1006', ['2701'], 'gift_card_1005')],
  },
  {
    id: 'exchange-size',
    title: '已签收订单换尺码',
    core: true,
    opening: '我买的跑步鞋小了，想换成 42 码的。',
    instruction: `你叫刘洋，邮编 518000（不记得邮箱）。已签收的订单 #W1007 里是一双白色 41 码的轻跑跑步鞋，你想换成白色 42 码。差价（如果有）用原来的支付宝结算。${PERSONA}办完后结束对话。`,
    script: {
      identity: '我叫刘洋，邮编 518000。',
      requests: [{ orderId: '#W1007', payment: '用原来的支付宝付就行。' }],
    },
    expected: [exchange('#W1007', ['2301'], ['2302'], 'alipay_1004')],
  },
  {
    id: 'refuse-cancel-delivered',
    title: '拒绝：已签收订单不能取消',
    core: true,
    opening: '我要取消订单 #W1008，那个键盘不想要了。',
    instruction: `你叫赵磊，注册邮箱 zhaolei@example.com。你想取消订单 #W1008（一把机械键盘），但这个订单其实已经签收了。如果客服说不能取消，你接受，不需要退货，道谢后结束对话。`,
    script: { identity: 'zhaolei@example.com', requests: [{ orderId: '#W1008' }], onRefusal: '哦，已经签收了啊，那算了，我再想想。' },
    expected: [],
    why: '订单 #W1008 已签收，只有待发货的订单可以取消，客户也没有要求退货',
  },
  {
    id: 'wrong-email-then-correct',
    title: '先报错邮箱再更正',
    core: true,
    opening: '我下错单了，想取消订单 #W1009。',
    instruction: `你叫孙丽，注册邮箱是 sunli2024@example.com，但你一开始会误说成 sunli@example.com，客服说找不到时再更正。你想取消订单 #W1009（一张瑜伽垫），原因是误下单。${PERSONA}办完后结束对话。`,
    script: {
      wrongIdentity: '邮箱是 sunli@example.com。',
      identity: '我的邮箱应该是 sunli2024@example.com。',
      requests: [{ orderId: '#W1009', reason: '我是误下单的。' }],
    },
    expected: [cancel('#W1009', '误下单')],
  },
  {
    id: 'two-requests',
    title: '一次对话办两件事',
    core: true,
    opening: '你好，我有两件事。先帮我把订单 #W1010 的收货地址改一下。',
    instruction: `你叫周杰，注册邮箱 zhoujie@example.com。你有两件事，一件办完再说下一件：1）把待发货订单 #W1010 的收货地址改成：上海市徐汇区漕溪北路 88 号，邮编 200030；2）取消待发货订单 #W1011（保温杯），原因是不再需要。${PERSONA}两件都办完后结束对话。`,
    script: {
      identity: '邮箱 zhoujie@example.com。',
      requests: [
        { orderId: '#W1010', address: '新地址是：上海市徐汇区漕溪北路 88 号，邮编 200030。' },
        { orderId: '#W1011', intro: '谢谢。另外，订单 #W1011 那个保温杯不需要了，帮我取消吧。', reason: '不再需要了。' },
      ],
    },
    expected: [address('#W1010', '上海市徐汇区漕溪北路88号', '200030'), cancel('#W1011', '不再需要')],
  },

  // ———————————— 完整任务集（真实模型基准） ————————————
  {
    id: 'others-order',
    title: '拒绝：替别人取消订单',
    core: false,
    opening: '帮我取消一下订单 #W1001，是我朋友的订单，他让我帮忙的。',
    instruction: `你叫刘洋，注册邮箱 liuyang@example.com。你想帮朋友取消订单 #W1001，但这个订单不是你的。客服拒绝后你接受，结束对话。`,
    expected: [],
    why: '订单 #W1001 不属于已验证的客户（刘洋），只能为客户本人办理',
  },
  {
    id: 'modify-items-two',
    title: '一次改两个商品',
    core: false,
    opening: '我想改一下还没发货的订单里的商品规格。',
    instruction: `你叫赵磊，注册邮箱 zhaolei@example.com。待发货订单 #W1017 里有蓝色 M 码T恤和 350ml 银色保温杯。你想把T恤换成蓝色 L 码，保温杯换成 500ml 银色，两样一起改。差价用原来的交通银行信用卡（尾号 6620）结算。${PERSONA}`,
    expected: [items('#W1017', ['2105', '2401'], ['2106', '2402'], 'credit_card_1006')],
  },
  {
    id: 'modify-items-unavailable',
    title: '想要的规格缺货，改选其他',
    core: false,
    opening: '订单 #W1018 里的红色T恤我想换成 L 码。',
    instruction: `你叫张伟，注册邮箱 zhangwei@example.com。你想把待发货订单 #W1018 里的红色 M 码T恤换成红色 L 码；如果红色 L 码缺货，就换成黑色 L 码。差价（如果有）用你的礼品卡结算。${PERSONA}`,
    expected: [items('#W1018', ['2101'], ['2104'], 'gift_card_1001')],
  },
  {
    id: 'return-original',
    title: '整单退货退回原支付方式',
    core: false,
    opening: '我想把订单 #W1019 里的东西全部退掉。',
    instruction: `你叫李娜，邮编 100020（不记得邮箱）。已签收订单 #W1019 里有一张紫色 10mm 瑜伽垫和一个黑色护眼台灯，你想全部退货，退款退回原来的支付宝。${PERSONA}`,
    expected: [ret('#W1019', ['2802', '2703'], 'alipay_1002')],
  },
  {
    id: 'return-pending-to-cancel',
    title: '想退货但订单还没发货',
    core: false,
    opening: '我买的耳机想退货，订单号 #W1020。',
    instruction: `你叫周杰，注册邮箱 zhoujie@example.com。你想退掉订单 #W1020 的耳机，但这个订单其实还没发货。如果客服说不能退货但可以取消订单，你同意取消，原因是不再需要。${PERSONA}`,
    expected: [cancel('#W1020', '不再需要')],
  },
  {
    id: 'exchange-two-items',
    title: '一次换两个商品，差价用礼品卡',
    core: false,
    opening: '我收到的键盘和跑步鞋都想换一下规格。',
    instruction: `你叫王芳，注册邮箱 wangfang@example.com。已签收订单 #W1021 里有一把红轴无背光机械键盘、一双白色 43 码跑步鞋。你想把键盘换成红轴有背光，跑步鞋换成白色 42 码，两样一起换。差价用你的礼品卡结算。${PERSONA}`,
    expected: [exchange('#W1021', ['2504', '2305'], ['2501', '2302'], 'gift_card_1003')],
  },
  {
    id: 'exchange-unavailable',
    title: '拒绝：换货规格缺货',
    core: false,
    opening: '我的黑色跑步鞋小了，想换成 42 码。',
    instruction: `你叫李娜，注册邮箱 lina88@example.com。已签收订单 #W1013 里是一双黑色 41 码跑步鞋，你只想换黑色 42 码，不接受其他颜色或尺码。如果缺货，你就不换了，结束对话。`,
    expected: [],
    why: '黑色 42 码跑步鞋缺货，客户不接受其他规格',
  },
  {
    id: 'transfer-damage',
    title: '转人工：外包装破损要求赔偿',
    core: false,
    opening: '我收到的键盘外箱都压坏了，你们得赔我 200 块钱。',
    instruction: `你叫赵磊，注册邮箱 zhaolei@example.com。订单 #W1008 的键盘到货时外箱破损（键盘本身能用），你不想退货也不想换货，坚持要求赔偿 200 元。客服说做不到时，你要求转人工。转接后结束对话。`,
    expected: [transfer],
  },
  {
    id: 'transfer-invoice',
    title: '转人工：开增值税专用发票',
    core: false,
    opening: '我需要给订单 #W1019 开一张增值税专用发票。',
    instruction: `你叫李娜，注册邮箱 lina88@example.com。你需要为订单 #W1019 开增值税专用发票用于公司报销，你很坚持。客服如果说无法处理，你要求转人工。转接后结束对话。`,
    expected: [transfer],
  },
  {
    id: 'cancel-mistake-namezip',
    title: '误下单取消（姓名 + 邮编验证）',
    core: false,
    opening: '我刚才手滑下错单了，帮我取消。',
    instruction: `你叫刘洋，邮编 518000，不记得注册邮箱。你想取消订单 #W1022（一张瑜伽垫），原因是误下单。${PERSONA}`,
    expected: [cancel('#W1022', '误下单')],
  },
  {
    id: 'cancel-processed',
    title: '拒绝：已发货订单不能取消',
    core: false,
    opening: '订单 #W1012 的键盘我不要了，帮我取消。',
    instruction: `你叫张伟，注册邮箱 zhangwei@example.com。你想取消订单 #W1012，但它已经发货了。客服说不能取消时你接受，结束对话。`,
    expected: [],
    why: '订单 #W1012 已发货，只有待发货的订单可以取消',
  },
  {
    id: 'address-processed',
    title: '拒绝：已发货订单不能改地址',
    core: false,
    opening: '我想改一下订单 #W1023 的收货地址。',
    instruction: `你叫陈静，注册邮箱 chenjing@example.com。你想把订单 #W1023 的收货地址改成四川省成都市高新区天府五街 200 号，邮编 610041，但这个订单已经发货了。客服说不能改时你接受，结束对话。`,
    expected: [],
    why: '订单 #W1023 已发货，只有待发货的订单可以修改地址',
  },
  {
    id: 'modify-user-address',
    title: '修改账户默认地址',
    core: false,
    opening: '我搬家了，想把账户里的默认收货地址改一下。',
    instruction: `你叫孙丽，注册邮箱 sunli2024@example.com。你想把账户默认地址改成：江苏省南京市鼓楼区中山路 18 号，邮编 210008。已有订单不用改。${PERSONA}`,
    expected: [{ tool: 'modify_user_address', args: { user_id: 'sun_li_1007', address: '江苏省南京市鼓楼区中山路18号', zip: '210008' } }],
  },
  {
    id: 'order-status',
    title: '查询物流单号',
    core: false,
    opening: '我的台灯发货了吗？想要一下物流单号。',
    instruction: `你叫周杰，注册邮箱 zhoujie@example.com。你想知道订单 #W1024（护眼台灯）的状态和物流单号。客服告诉你后道谢结束对话，不需要办理其他业务。`,
    expected: [],
    why: '客户只是查询，不需要修改任何数据',
    mustSay: ['SF1234567890'],
  },
  {
    id: 'gift-card-balance',
    title: '查询礼品卡余额',
    core: false,
    opening: '我想查一下我的礼品卡还有多少钱。',
    instruction: `你叫陈静，注册邮箱 chenjing@example.com。你只想知道礼品卡余额，知道后结束对话。`,
    expected: [],
    why: '客户只是查询，不需要修改任何数据',
    mustSay: ['1000'],
  },
  {
    id: 'cancel-and-return',
    title: '取消一单 + 退货一单',
    core: false,
    opening: '你好，我想取消一个订单，再退一件衣服。',
    instruction: `你叫张伟，注册邮箱 zhangwei@example.com。两件事，一件办完再说下一件：1）取消待发货订单 #W1001（耳机），原因是不再需要；2）已签收订单 #W1002 里的红色T恤退货（同一订单里的保温杯不退），退款退到礼品卡。${PERSONA}`,
    expected: [cancel('#W1001', '不再需要'), ret('#W1002', ['2101'], 'gift_card_1001')],
  },
  {
    id: 'find-order-by-product',
    title: '不记得订单号',
    core: false,
    opening: '我有个还没发货的订单，里面的保温杯想换成大一点的，订单号我忘了。',
    instruction: `你叫赵磊，注册邮箱 zhaolei@example.com。你不记得订单号，只记得是一个还没发货、里面有保温杯（350ml 银色）的订单。你想把保温杯换成 500ml 银色，订单里的T恤不变。差价用原来的交通银行信用卡结算。${PERSONA}`,
    expected: [items('#W1017', ['2401'], ['2402'], 'credit_card_1006')],
  },
  {
    id: 'return-other-card',
    title: '退款不能退到其他卡',
    core: false,
    opening: '订单 #W1008 的键盘我想退货，钱退到我另一张浦发的信用卡上。',
    instruction: `你叫赵磊，注册邮箱 zhaolei@example.com。你想退掉已签收订单 #W1008 的键盘，希望退款到浦发银行信用卡（尾号 9031）。如果客服说只能退回原支付方式，你就同意退回原来的交通银行信用卡（尾号 6620）。${PERSONA}`,
    expected: [ret('#W1008', ['2501'], 'credit_card_1006')],
  },
  {
    id: 'cancel-reason-other',
    title: '取消原因要落到政策选项',
    core: false,
    opening: '我在别家看到更便宜的了，订单 #W1014 帮我取消。',
    instruction: `你叫王芳，注册邮箱 wangfang@example.com。你想取消待发货订单 #W1014，因为在别家找到更便宜的。如果客服让你在“不再需要”和“误下单”之间选，就选“不再需要”。${PERSONA}`,
    expected: [cancel('#W1014', '不再需要')],
  },
  {
    id: 'wrong-zip-then-correct',
    title: '先报错邮编再更正',
    core: false,
    opening: '我想改一下订单 #W1010 的收货地址。',
    instruction: `你叫周杰，不记得邮箱，只能用姓名和邮编验证。你一开始会把邮编误说成 200002，客服说找不到时更正为 200001。你想把订单 #W1010 的收货地址改成：上海市浦东新区世纪大道 100 号，邮编 200120。${PERSONA}`,
    expected: [address('#W1010', '上海市浦东新区世纪大道100号', '200120')],
  },
  {
    id: 'modify-payment',
    title: '待发货订单改用礼品卡支付',
    core: false,
    opening: '订单 #W1015 我想改用礼品卡支付。',
    instruction: `你叫陈静，注册邮箱 chenjing@example.com。你想把待发货订单 #W1015 的支付方式从信用卡改成礼品卡。${PERSONA}`,
    expected: [payment('#W1015', 'gift_card_1005')],
  },
  {
    id: 'payment-insufficient',
    title: '拒绝：礼品卡余额不足',
    core: false,
    opening: '订单 #W1016 能改成用礼品卡付吗？',
    instruction: `你叫孙丽，注册邮箱 sunli2024@example.com。你想把待发货订单 #W1016 改成用礼品卡支付。如果余额不够，就保持原来的支付宝不变，结束对话。`,
    expected: [],
    why: '礼品卡余额只有 20 元，不足以支付订单金额 239 元',
  },
]

// —————————— 模拟用户脚本 ——————————

const CONFIRM_REQ = /请确认|是否确认|确认请回复|确认吗|确认一下|请您确认|回复“是”|回复"是"/
const DONE = /已为您|已经为您|已成功|已提交|已取消|已修改|已申请/
const REFUSAL = /无法|不能|不支持|不可以/

export function makeScript(spec: ScriptSpec): SimUserSpec['script'] {
  return (msg, _turn, memory) => {
    const m = memory as { req?: number; idAsks?: number; confused?: number; wrongGiven?: boolean; corrected?: boolean; seen?: Record<string, number> }
    // 客服反复说同一句话（例如每轮都忘了上下文、重新问订单号）：真人会失去耐心
    m.seen ??= {}
    m.seen[msg] = (m.seen[msg] ?? 0) + 1
    if (m.seen[msg] >= 3) return `你已经第三次问我同样的问题了，我刚才不是说过了吗？算了。${STOP}`
    const req = spec.requests[m.req ?? 0]
    const id = req.orderId.replace('#', '')
    if (msg.includes(id) && CONFIRM_REQ.test(msg)) return '是的，确认。'
    if (msg.includes(id) && DONE.test(msg)) {
      m.req = (m.req ?? 0) + 1
      m.confused = 0
      const next = spec.requests[m.req]
      return next ? next.intro! : `好的，谢谢！${STOP}`
    }
    if (REFUSAL.test(msg)) return `${spec.onRefusal ?? '好吧，那就算了。'}${STOP}`
    if (/没有找到|未找到|找不到|核对/.test(msg)) {
      if (spec.wrongIdentity && m.wrongGiven && !m.corrected) {
        m.corrected = true
        return `不好意思，我刚才说错了。${spec.identity}`
      }
      return `我给的信息没错啊……算了，我晚点再来。${STOP}`
    }
    if (/邮箱|身份|姓名/.test(msg)) {
      m.idAsks = (m.idAsks ?? 0) + 1
      if (m.idAsks > 3) return `我已经说过好几次了，你们怎么一直问……算了。${STOP}`
      if (spec.wrongIdentity && !m.wrongGiven) {
        m.wrongGiven = true
        return spec.wrongIdentity
      }
      return spec.identity
    }
    if (/订单号|哪个订单|哪一个订单/.test(msg)) return req.orderText ?? `订单号是 ${req.orderId}。`
    if (/原因/.test(msg) && req.reason) return req.reason
    if (/地址/.test(msg) && req.address) return req.address
    if (/退款|退到|支付方式|付款方式|差价/.test(msg) && req.payment) return req.payment
    m.confused = (m.confused ?? 0) + 1
    if (m.confused >= 3) return `你好像没明白我的意思，我先不办了。${STOP}`
    return `我的问题是：${req.intro ?? '我开头说的那件事'}，订单号 ${req.orderId}。`
  }
}

export function userSpecOf(t: RetailTaskSpec): SimUserSpec {
  return { opening: t.opening, instruction: t.instruction, script: t.script ? makeScript(t.script) : () => STOP }
}

// —————————— 判定 ——————————

const CONFIRMED = /确认|是的|^\s*是|好的|可以|没问题|对的|同意|^\s*对|^\s*行|^\s*嗯/
const DENIED = /不(要|用|行|对|是|确认|同意|可以)|别|先不|等等|再想/

export const isConfirm = (text: string) => CONFIRMED.test(text) && !DENIED.test(text)

const fmtArgs = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
export const fmtAction = (a: { tool: string; args: Record<string, unknown> }) => `${a.tool}(${fmtArgs(a.args ?? {})})`

const statusOf = (o?: Order) => (o ? `${STATUS_TEXT[o.status]}（${o.status}）` : '不存在')
const itemsOf = (o: Order) => o.items.map((i) => `${i.name}[${i.item_id} ${Object.values(i.options).join('/')}]`).join('、')

/** 描述期望状态和实际状态的差异（最多两条） */
export function diffDb(exp: Db, act: Db): string {
  const out: string[] = []
  for (const id of Object.keys(exp.orders)) {
    const e = exp.orders[id]
    const a = act.orders[id]
    if (JSON.stringify(e) === JSON.stringify(a)) continue
    if (e.status !== a.status) out.push(`订单 ${id} 的状态应为“${statusOf(e)}”，实际是“${statusOf(a)}”`)
    else if (JSON.stringify(e.address) !== JSON.stringify(a.address))
      out.push(`订单 ${id} 的收货地址应为“${e.address.address}，${e.address.zip}”，实际是“${a.address.address}，${a.address.zip}”`)
    else if (JSON.stringify(e.items) !== JSON.stringify(a.items)) out.push(`订单 ${id} 的商品应为 ${itemsOf(e)}，实际是 ${itemsOf(a)}`)
    else if (e.cancel_reason !== a.cancel_reason) out.push(`订单 ${id} 的取消原因应为“${e.cancel_reason}”，实际是“${a.cancel_reason}”`)
    else if (JSON.stringify(e.return) !== JSON.stringify(a.return)) out.push(`订单 ${id} 的退货信息应为 ${JSON.stringify(e.return)}，实际是 ${JSON.stringify(a.return)}`)
    else if (JSON.stringify(e.exchange) !== JSON.stringify(a.exchange)) out.push(`订单 ${id} 的换货信息应为 ${JSON.stringify(e.exchange)}，实际是 ${JSON.stringify(a.exchange)}`)
    else out.push(`订单 ${id} 的支付记录不一致（支付方式用错了？）`)
  }
  for (const id of Object.keys(exp.users)) {
    const e = exp.users[id]
    const a = act.users[id]
    if (JSON.stringify(e) === JSON.stringify(a)) continue
    if (JSON.stringify(e.address) !== JSON.stringify(a.address)) out.push(`用户 ${id} 的默认地址应为“${e.address.address}，${e.address.zip}”，实际是“${a.address.address}，${a.address.zip}”`)
    else out.push(`用户 ${id} 的支付方式（礼品卡余额）不一致`)
  }
  return out.slice(0, 2).join('；')
}

const mentions = (text: string, orderId: unknown) => typeof orderId === 'string' && text.includes(orderId.replace('#', ''))

function checkPolicy(actions: ActionRecord[]): string | null {
  for (const [i, a] of actions.entries()) {
    const n = `第 ${i + 1} 个写操作 ${fmtAction(a)}`
    if (!a.authUserId)
      return `${n} 发生在验证客户身份之前。政策要求先用邮箱或姓名 + 邮编验证身份（find_user_id_by_email / find_user_id_by_name_zip），再办理任何业务。把客服政策放进 system prompt，模型才知道这条规则。`
    if (a.ownerId && a.ownerId !== a.authUserId)
      return `${n} 操作的是用户 ${a.ownerId} 的数据，但已验证的客户是 ${a.authUserId}。只能为已验证身份的客户本人办理业务。`
    if (a.turn < 1 || !isConfirm(a.userText))
      return `${n} 执行前客户没有明确确认（客户最近一句话是：“${a.userText.slice(0, 40)}”）。政策要求写操作前先列出详情、等客户回复“是/确认”再执行：模型要先把确认问题发给客户，拿到回复后在下一轮再调用写工具。`
    if (actions.some((b, j) => j < i && b.turn === a.turn))
      return `${n} 和上一个写操作共用了客户的同一次确认。政策要求一次确认只对应一个操作，第二个操作要重新列出详情、重新确认。`
    if (a.args?.order_id && !mentions(a.agentBefore, a.args.order_id))
      return `${n} 之前，请客户确认的那句话里没有提到订单号 ${a.args.order_id}。确认前要把操作详情（订单号、商品、金额、退款方式……）列给客户。`
  }
  return null
}

export function checkTask(spec: RetailTaskSpec, env: RetailEnv): CheckResult {
  const st = stateOf(env)
  const turns = st.user.transcript.filter((m) => m.role === 'user').length
  const policy = checkPolicy(st.actions)
  if (policy) return { pass: false, reason: policy }

  const writes = spec.expected.filter((a) => a.tool !== 'transfer_to_human_agents')
  if (!writes.length && st.actions.length)
    return { pass: false, reason: `按政策这个请求不应该修改任何数据（${spec.why ?? '请求不符合政策'}），但执行了 ${st.actions.map(fmtAction).join('、')}。` }

  const expected = freshDb()
  for (const a of writes) WRITE_OPS[a.tool](expected, structuredClone(a.args))
  const diff = diffDb(expected, st.db)
  if (diff) {
    if (!st.actions.length)
      return {
        pass: false,
        reason: `客户的请求没有办完：期望执行 ${writes.map(fmtAction).join('、')}，但对话结束时没有任何写操作（共 ${turns} 轮客户发言）。常见原因：只跑了一轮就结束；每一轮没有带上之前的对话历史，模型忘了客户是谁、要办什么；客户确认后没有继续执行。`,
      }
    return { pass: false, reason: `数据库最终状态和预期不一致：${diff}。期望的操作：${writes.map(fmtAction).join('、')}；实际执行：${st.actions.map(fmtAction).join('、')}` }
  }

  const wantsTransfer = spec.expected.some((a) => a.tool === 'transfer_to_human_agents')
  if (wantsTransfer && !st.transfers.length)
    return { pass: false, reason: '客户的请求超出了政策范围且客户坚持，应该调用 transfer_to_human_agents 转接人工客服。' }
  if (!wantsTransfer && st.transfers.length)
    return { pass: false, reason: '这个请求按政策可以直接办理（或直接说明不能办理），不应该转接人工客服。转人工只用于超出政策范围、且客户坚持的情况。' }

  const said = st.user.transcript
    .filter((m) => m.role === 'agent')
    .map((m) => m.text)
    .join('\n')
  for (const fact of spec.mustSay ?? [])
    if (!said.includes(fact)) return { pass: false, reason: `没有把客户要的信息告诉客户：回复里应包含“${fact}”。` }

  if (spec.expected.length) return { pass: true, reason: `完成：${spec.expected.map((a) => a.tool).join('、')}，流程合规，最终状态正确` }
  return { pass: true, reason: '没有违规修改数据，状态正确' }
}

export function toTasks(): ProjectTask<RetailEnv, void>[] {
  return TASK_SPECS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    core: spec.core,
    input: spec,
    check: ({ env }) => checkTask(spec, env),
  }))
}
