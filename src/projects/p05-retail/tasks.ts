/**
 * P5 任务集：每个任务 = 一位客户（模拟用户）+ 期望的写操作列表。
 * 判定（与模型无关，τ-bench 的做法）：
 *   1. 流程合规：写操作前已验证身份、只操作本人数据、每个写操作前客户明确确认过、一次确认只对应一个操作；
 *   2. 结果正确：把期望的写操作作用在初始数据库上，得到期望的最终状态，和实际最终状态逐字段比较；
 *   3. 需要转人工 / 需要告诉客户某个信息的任务，额外检查对应结果。
 */
import { STOP, type SimUserSpec } from '../usersim'
import type { CheckResult, ProjectTask } from '../types'
import { L } from '../../engine/locale'
import { freshDb, STATUS_TEXT, type Db, type Order } from './env/data'
import { stateOf, type ActionRecord, type RetailEnv } from './env/index'
import { CANCEL_REASONS, WRITE_OPS } from './env/ops'

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

const PERSONA = L(
  '客服要求验证身份时提供上面的身份信息。客服列出操作详情请你确认时，核对无误就明确回复“是的，确认”。',
  'When the agent asks you to verify your identity, give the identity details above. When the agent lists the details of an action and asks you to confirm, check them and, if they are correct, clearly reply "Yes, I confirm."',
)
const [NO_NEED, MISTAKE] = CANCEL_REASONS

export const TASK_SPECS: RetailTaskSpec[] = [
  // ———————————— 核心任务（模拟模型可解，参与评星） ————————————
  {
    id: 'cancel-pending',
    title: L('取消待发货订单', 'Cancel a pending order'),
    core: true,
    opening: L('你好，我想取消一个还没发货的订单。', 'Hi, I\'d like to cancel an order that hasn\'t shipped yet.'),
    instruction: L(
      `你叫张伟，注册邮箱 zhangwei@example.com。你想取消订单 #W1001（一副白色降噪蓝牙耳机），原因是不再需要了。${PERSONA}办完后道谢并结束对话。`,
      `Your name is Zhang Wei and your account email is zhangwei@example.com. You want to cancel order #W1001 (a pair of white noise-cancelling Bluetooth earbuds) because you no longer need it. ${PERSONA} Say thanks and end the conversation once it's done.`,
    ),
    script: { identity: L('我的邮箱是 zhangwei@example.com。', 'My email is zhangwei@example.com.'), requests: [{ orderId: '#W1001', orderText: L('订单号是 #W1001，那副蓝牙耳机我不想要了。', 'It\'s order #W1001. I don\'t need those earbuds anymore.'), reason: L('不再需要了。', 'I no longer need it.') }] },
    expected: [cancel('#W1001', NO_NEED)],
  },
  {
    id: 'modify-address',
    title: L('修改收货地址（姓名 + 邮编验证）', 'Change the shipping address (name + zip verification)'),
    core: true,
    opening: L('我下单时地址填错了，想改一下收货地址。', 'I entered the wrong address on my order and need to change the shipping address.'),
    instruction: L(
      `你叫李娜，邮编 100020，你不记得注册邮箱了，只能用姓名和邮编验证。你想把待发货订单 #W1004 的收货地址改成：北京市海淀区中关村大街27号，邮编 100080。${PERSONA}办完后结束对话。`,
      `Your name is Li Na and your zip code is 100020. You don't remember your account email, so you can only verify with your name and zip code. You want to change the shipping address of pending order #W1004 to: 27 Zhongguancun Street, Haidian District, Beijing, zip code 100080. ${PERSONA} End the conversation once it's done.`,
    ),
    script: {
      identity: L('我不记得邮箱了。我叫李娜，邮编 100020。', 'I don\'t remember my email. My name is Li Na, zip code 100020.'),
      requests: [{ orderId: '#W1004', address: L('新地址是：北京市海淀区中关村大街27号，邮编 100080。', 'The new address is: 27 Zhongguancun Street, Haidian District, Beijing, zip code 100080.') }],
    },
    expected: [address('#W1004', L('北京市海淀区中关村大街27号', '27 Zhongguancun Street, Haidian District, Beijing'), '100080')],
  },
  {
    id: 'modify-items',
    title: L('待发货订单改尺码', 'Change the size in a pending order'),
    core: true,
    opening: L('我有个订单还没发货，想把里面的T恤换成 L 码，颜色不变。', 'One of my orders hasn\'t shipped yet. I\'d like to change the T-shirt in it to size L, same color.'),
    instruction: L(
      `你叫王芳，注册邮箱 wangfang@example.com。你的待发货订单 #W1005 里有一件黑色 M 码的纯棉T恤，你想换成黑色 L 码，订单里的双肩包不变。差价（如果有）用原来的信用卡结算。${PERSONA}办完后结束对话。`,
      `Your name is Wang Fang and your account email is wangfang@example.com. Your pending order #W1005 contains a black size M cotton T-shirt, which you want to change to black size L; the backpack in the order stays as is. Any price difference goes on the original credit card. ${PERSONA} End the conversation once it's done.`,
    ),
    script: {
      identity: L('邮箱是 wangfang@example.com。', 'My email is wangfang@example.com.'),
      requests: [{ orderId: '#W1005', payment: L('差价就用原来的信用卡付吧。', 'Just put the difference on the original credit card.') }],
    },
    expected: [items('#W1005', ['2103'], ['2104'], 'credit_card_1003')],
  },
  {
    id: 'return-giftcard',
    title: L('退货退到礼品卡', 'Return with a refund to the gift card'),
    core: true,
    opening: L('我收到的台灯不想要了，想退货。', 'I don\'t want the desk lamp I received. I\'d like to return it.'),
    instruction: L(
      `你叫陈静，注册邮箱 chenjing@example.com。已签收的订单 #W1006 里有一个白色护眼台灯和一副耳机，你只想退台灯，耳机留着。退款退到你的礼品卡。${PERSONA}办完后结束对话。`,
      `Your name is Chen Jing and your account email is chenjing@example.com. Delivered order #W1006 contains a white eye-care desk lamp and a pair of earbuds. You only want to return the lamp and keep the earbuds. The refund should go to your gift card. ${PERSONA} End the conversation once it's done.`,
    ),
    script: {
      identity: L('我的邮箱：chenjing@example.com', 'My email: chenjing@example.com'),
      requests: [{ orderId: '#W1006', payment: L('退款请退到我的礼品卡里。', 'Please refund it to my gift card.') }],
    },
    expected: [ret('#W1006', ['2701'], 'gift_card_1005')],
  },
  {
    id: 'exchange-size',
    title: L('已签收订单换尺码', 'Exchange a delivered item for another size'),
    core: true,
    opening: L('我买的跑步鞋小了，想换成 42 码的。', 'The running shoes I bought are too small. I\'d like to exchange them for a size 42.'),
    instruction: L(
      `你叫刘洋，邮编 518000（不记得邮箱）。已签收的订单 #W1007 里是一双白色 41 码的轻跑跑步鞋，你想换成白色 42 码。差价（如果有）用原来的支付宝结算。${PERSONA}办完后结束对话。`,
      `Your name is Liu Yang and your zip code is 518000 (you don't remember your email). Delivered order #W1007 is a pair of white size 41 Lite running shoes, and you want to exchange them for white size 42. Any price difference goes on the original Alipay account. ${PERSONA} End the conversation once it's done.`,
    ),
    script: {
      identity: L('我叫刘洋，邮编 518000。', 'My name is Liu Yang, zip code 518000.'),
      requests: [{ orderId: '#W1007', payment: L('用原来的支付宝付就行。', 'Just use the original Alipay account.') }],
    },
    expected: [exchange('#W1007', ['2301'], ['2302'], 'alipay_1004')],
  },
  {
    id: 'refuse-cancel-delivered',
    title: L('拒绝：已签收订单不能取消', 'Refuse: a delivered order can\'t be cancelled'),
    core: true,
    opening: L('我要取消订单 #W1008，那个键盘不想要了。', 'I want to cancel order #W1008. I don\'t want that keyboard anymore.'),
    instruction: L(
      `你叫赵磊，注册邮箱 zhaolei@example.com。你想取消订单 #W1008（一把机械键盘），但这个订单其实已经签收了。如果客服说不能取消，你接受，不需要退货，道谢后结束对话。`,
      `Your name is Zhao Lei and your account email is zhaolei@example.com. You want to cancel order #W1008 (a mechanical keyboard), but it has actually already been delivered. If the agent says it can't be cancelled, accept that; you don't want a return. Say thanks and end the conversation.`,
    ),
    script: { identity: 'zhaolei@example.com', requests: [{ orderId: '#W1008' }], onRefusal: L('哦，已经签收了啊，那算了，我再想想。', 'Oh, it\'s already been delivered? Never mind then, I\'ll think about it.') },
    expected: [],
    why: L('订单 #W1008 已签收，只有待发货的订单可以取消，客户也没有要求退货', 'order #W1008 has been delivered; only pending orders can be cancelled, and the customer did not ask for a return'),
  },
  {
    id: 'wrong-email-then-correct',
    title: L('先报错邮箱再更正', 'Wrong email first, then corrected'),
    core: true,
    opening: L('我下错单了，想取消订单 #W1009。', 'I placed order #W1009 by mistake and want to cancel it.'),
    instruction: L(
      `你叫孙丽，注册邮箱是 sunli2024@example.com，但你一开始会误说成 sunli@example.com，客服说找不到时再更正。你想取消订单 #W1009（一张瑜伽垫），原因是误下单。${PERSONA}办完后结束对话。`,
      `Your name is Sun Li and your account email is sunli2024@example.com, but at first you mistakenly say sunli@example.com; correct it when the agent says it can't find you. You want to cancel order #W1009 (a yoga mat) because you ordered it by mistake. ${PERSONA} End the conversation once it's done.`,
    ),
    script: {
      wrongIdentity: L('邮箱是 sunli@example.com。', 'My email is sunli@example.com.'),
      identity: L('我的邮箱应该是 sunli2024@example.com。', 'My email should be sunli2024@example.com.'),
      requests: [{ orderId: '#W1009', reason: L('我是误下单的。', 'I ordered it by mistake.') }],
    },
    expected: [cancel('#W1009', MISTAKE)],
  },
  {
    id: 'two-requests',
    title: L('一次对话办两件事', 'Two requests in one conversation'),
    core: true,
    opening: L('你好，我有两件事。先帮我把订单 #W1010 的收货地址改一下。', 'Hi, I have two things. First, please change the shipping address on order #W1010.'),
    instruction: L(
      `你叫周杰，注册邮箱 zhoujie@example.com。你有两件事，一件办完再说下一件：1）把待发货订单 #W1010 的收货地址改成：上海市徐汇区漕溪北路 88 号，邮编 200030；2）取消待发货订单 #W1011（保温杯），原因是不再需要。${PERSONA}两件都办完后结束对话。`,
      `Your name is Zhou Jie and your account email is zhoujie@example.com. You have two things to do; bring up the second only after the first is done: 1) change the shipping address of pending order #W1010 to: 88 North Caoxi Road, Xuhui District, Shanghai, zip code 200030; 2) cancel pending order #W1011 (the flask) because you no longer need it. ${PERSONA} End the conversation once both are done.`,
    ),
    script: {
      identity: L('邮箱 zhoujie@example.com。', 'Email: zhoujie@example.com.'),
      requests: [
        { orderId: '#W1010', address: L('新地址是：上海市徐汇区漕溪北路 88 号，邮编 200030。', 'The new address is: 88 North Caoxi Road, Xuhui District, Shanghai, zip code 200030.') },
        { orderId: '#W1011', intro: L('谢谢。另外，订单 #W1011 那个保温杯不需要了，帮我取消吧。', 'Thanks. Also, I don\'t need the flask in order #W1011 anymore, please cancel it.'), reason: L('不再需要了。', 'I no longer need it.') },
      ],
    },
    expected: [address('#W1010', L('上海市徐汇区漕溪北路88号', '88 North Caoxi Road, Xuhui District, Shanghai'), '200030'), cancel('#W1011', NO_NEED)],
  },

  // ———————————— 完整任务集（真实模型基准） ————————————
  {
    id: 'others-order',
    title: L('拒绝：替别人取消订单', 'Refuse: cancelling someone else\'s order'),
    core: false,
    opening: L('帮我取消一下订单 #W1001，是我朋友的订单，他让我帮忙的。', 'Please cancel order #W1001 for me. It\'s my friend\'s order; he asked me to help.'),
    instruction: L(
      `你叫刘洋，注册邮箱 liuyang@example.com。你想帮朋友取消订单 #W1001，但这个订单不是你的。客服拒绝后你接受，结束对话。`,
      `Your name is Liu Yang and your account email is liuyang@example.com. You want to cancel order #W1001 for a friend, but it isn't your order. Accept it when the agent refuses and end the conversation.`,
    ),
    expected: [],
    why: L('订单 #W1001 不属于已验证的客户（刘洋），只能为客户本人办理', 'order #W1001 doesn\'t belong to the verified customer (Liu Yang); you can only act for the customer themselves'),
  },
  {
    id: 'modify-items-two',
    title: L('一次改两个商品', 'Change two items at once'),
    core: false,
    opening: L('我想改一下还没发货的订单里的商品规格。', 'I\'d like to change the item options in an order that hasn\'t shipped yet.'),
    instruction: L(
      `你叫赵磊，注册邮箱 zhaolei@example.com。待发货订单 #W1017 里有蓝色 M 码T恤和 350ml 银色保温杯。你想把T恤换成蓝色 L 码，保温杯换成 500ml 银色，两样一起改。差价用原来的交通银行信用卡（尾号 6620）结算。${PERSONA}`,
      `Your name is Zhao Lei and your account email is zhaolei@example.com. Pending order #W1017 contains a blue size M T-shirt and a 350ml silver flask. You want to change the T-shirt to blue size L and the flask to 500ml silver, both at once. The difference goes on the original Bank of Communications credit card (ending 6620). ${PERSONA}`,
    ),
    expected: [items('#W1017', ['2105', '2401'], ['2106', '2402'], 'credit_card_1006')],
  },
  {
    id: 'modify-items-unavailable',
    title: L('想要的规格缺货，改选其他', 'Wanted option out of stock, pick another'),
    core: false,
    opening: L('订单 #W1018 里的红色T恤我想换成 L 码。', 'I\'d like to change the red T-shirt in order #W1018 to size L.'),
    instruction: L(
      `你叫张伟，注册邮箱 zhangwei@example.com。你想把待发货订单 #W1018 里的红色 M 码T恤换成红色 L 码；如果红色 L 码缺货，就换成黑色 L 码。差价（如果有）用你的礼品卡结算。${PERSONA}`,
      `Your name is Zhang Wei and your account email is zhangwei@example.com. You want to change the red size M T-shirt in pending order #W1018 to red size L; if red L is out of stock, take black size L instead. Any price difference goes on your gift card. ${PERSONA}`,
    ),
    expected: [items('#W1018', ['2101'], ['2104'], 'gift_card_1001')],
  },
  {
    id: 'return-original',
    title: L('整单退货退回原支付方式', 'Return the whole order to the original payment method'),
    core: false,
    opening: L('我想把订单 #W1019 里的东西全部退掉。', 'I\'d like to return everything in order #W1019.'),
    instruction: L(
      `你叫李娜，邮编 100020（不记得邮箱）。已签收订单 #W1019 里有一张紫色 10mm 瑜伽垫和一个黑色护眼台灯，你想全部退货，退款退回原来的支付宝。${PERSONA}`,
      `Your name is Li Na and your zip code is 100020 (you don't remember your email). Delivered order #W1019 contains a purple 10mm yoga mat and a black eye-care desk lamp. You want to return everything, with the refund going back to the original Alipay account. ${PERSONA}`,
    ),
    expected: [ret('#W1019', ['2802', '2703'], 'alipay_1002')],
  },
  {
    id: 'return-pending-to-cancel',
    title: L('想退货但订单还没发货', 'Wants a return, but the order hasn\'t shipped'),
    core: false,
    opening: L('我买的耳机想退货，订单号 #W1020。', 'I\'d like to return the earbuds I bought, order #W1020.'),
    instruction: L(
      `你叫周杰，注册邮箱 zhoujie@example.com。你想退掉订单 #W1020 的耳机，但这个订单其实还没发货。如果客服说不能退货但可以取消订单，你同意取消，原因是不再需要。${PERSONA}`,
      `Your name is Zhou Jie and your account email is zhoujie@example.com. You want to return the earbuds in order #W1020, but the order actually hasn't shipped yet. If the agent says it can't be returned but can be cancelled, agree to cancel; the reason is that you no longer need it. ${PERSONA}`,
    ),
    expected: [cancel('#W1020', NO_NEED)],
  },
  {
    id: 'exchange-two-items',
    title: L('一次换两个商品，差价用礼品卡', 'Exchange two items, difference paid by gift card'),
    core: false,
    opening: L('我收到的键盘和跑步鞋都想换一下规格。', 'I\'d like to exchange both the keyboard and the running shoes I received for different options.'),
    instruction: L(
      `你叫王芳，注册邮箱 wangfang@example.com。已签收订单 #W1021 里有一把红轴无背光机械键盘、一双白色 43 码跑步鞋。你想把键盘换成红轴有背光，跑步鞋换成白色 42 码，两样一起换。差价用你的礼品卡结算。${PERSONA}`,
      `Your name is Wang Fang and your account email is wangfang@example.com. Delivered order #W1021 contains a mechanical keyboard with red switches and no backlight, and a pair of white size 43 running shoes. You want to exchange the keyboard for red switches with backlight and the shoes for white size 42, both at once. The difference goes on your gift card. ${PERSONA}`,
    ),
    expected: [exchange('#W1021', ['2504', '2305'], ['2501', '2302'], 'gift_card_1003')],
  },
  {
    id: 'exchange-unavailable',
    title: L('拒绝：换货规格缺货', 'Refuse: the exchange option is out of stock'),
    core: false,
    opening: L('我的黑色跑步鞋小了，想换成 42 码。', 'My black running shoes are too small. I\'d like a size 42.'),
    instruction: L(
      `你叫李娜，注册邮箱 lina88@example.com。已签收订单 #W1013 里是一双黑色 41 码跑步鞋，你只想换黑色 42 码，不接受其他颜色或尺码。如果缺货，你就不换了，结束对话。`,
      `Your name is Li Na and your account email is lina88@example.com. Delivered order #W1013 is a pair of black size 41 running shoes. You only want black size 42 and won't accept any other color or size. If it's out of stock, forget the exchange and end the conversation.`,
    ),
    expected: [],
    why: L('黑色 42 码跑步鞋缺货，客户不接受其他规格', 'black size 42 running shoes are out of stock, and the customer won\'t accept another option'),
  },
  {
    id: 'transfer-damage',
    title: L('转人工：外包装破损要求赔偿', 'Transfer: damaged box, customer demands compensation'),
    core: false,
    opening: L('我收到的键盘外箱都压坏了，你们得赔我 200 块钱。', 'The box my keyboard came in was crushed. You owe me ¥200 in compensation.'),
    instruction: L(
      `你叫赵磊，注册邮箱 zhaolei@example.com。订单 #W1008 的键盘到货时外箱破损（键盘本身能用），你不想退货也不想换货，坚持要求赔偿 200 元。客服说做不到时，你要求转人工。转接后结束对话。`,
      `Your name is Zhao Lei and your account email is zhaolei@example.com. The keyboard from order #W1008 arrived with a damaged box (the keyboard itself works). You don't want a return or an exchange; you insist on ¥200 compensation. When the agent says they can't do that, ask for a human agent. End the conversation after the transfer.`,
    ),
    expected: [transfer],
  },
  {
    id: 'transfer-invoice',
    title: L('转人工：开增值税专用发票', 'Transfer: special VAT invoice'),
    core: false,
    opening: L('我需要给订单 #W1019 开一张增值税专用发票。', 'I need a special VAT invoice for order #W1019.'),
    instruction: L(
      `你叫李娜，注册邮箱 lina88@example.com。你需要为订单 #W1019 开增值税专用发票用于公司报销，你很坚持。客服如果说无法处理，你要求转人工。转接后结束对话。`,
      `Your name is Li Na and your account email is lina88@example.com. You need a special VAT invoice for order #W1019 for company reimbursement, and you insist. If the agent says they can't handle it, ask for a human agent. End the conversation after the transfer.`,
    ),
    expected: [transfer],
  },
  {
    id: 'cancel-mistake-namezip',
    title: L('误下单取消（姓名 + 邮编验证）', 'Cancel an accidental order (name + zip verification)'),
    core: false,
    opening: L('我刚才手滑下错单了，帮我取消。', 'I just placed an order by accident. Please cancel it.'),
    instruction: L(
      `你叫刘洋，邮编 518000，不记得注册邮箱。你想取消订单 #W1022（一张瑜伽垫），原因是误下单。${PERSONA}`,
      `Your name is Liu Yang and your zip code is 518000; you don't remember your account email. You want to cancel order #W1022 (a yoga mat) because you ordered it by mistake. ${PERSONA}`,
    ),
    expected: [cancel('#W1022', MISTAKE)],
  },
  {
    id: 'cancel-processed',
    title: L('拒绝：已发货订单不能取消', 'Refuse: a shipped order can\'t be cancelled'),
    core: false,
    opening: L('订单 #W1012 的键盘我不要了，帮我取消。', 'I don\'t want the keyboard in order #W1012 anymore. Please cancel it.'),
    instruction: L(
      `你叫张伟，注册邮箱 zhangwei@example.com。你想取消订单 #W1012，但它已经发货了。客服说不能取消时你接受，结束对话。`,
      `Your name is Zhang Wei and your account email is zhangwei@example.com. You want to cancel order #W1012, but it has already shipped. Accept it when the agent says it can't be cancelled and end the conversation.`,
    ),
    expected: [],
    why: L('订单 #W1012 已发货，只有待发货的订单可以取消', 'order #W1012 has shipped; only pending orders can be cancelled'),
  },
  {
    id: 'address-processed',
    title: L('拒绝：已发货订单不能改地址', 'Refuse: a shipped order\'s address can\'t be changed'),
    core: false,
    opening: L('我想改一下订单 #W1023 的收货地址。', 'I\'d like to change the shipping address on order #W1023.'),
    instruction: L(
      `你叫陈静，注册邮箱 chenjing@example.com。你想把订单 #W1023 的收货地址改成四川省成都市高新区天府五街 200 号，邮编 610041，但这个订单已经发货了。客服说不能改时你接受，结束对话。`,
      `Your name is Chen Jing and your account email is chenjing@example.com. You want to change the shipping address of order #W1023 to 200 Tianfu 5th Street, High-tech Zone, Chengdu, Sichuan, zip code 610041, but the order has already shipped. Accept it when the agent says it can't be changed and end the conversation.`,
    ),
    expected: [],
    why: L('订单 #W1023 已发货，只有待发货的订单可以修改地址', 'order #W1023 has shipped; only pending orders can have their address changed'),
  },
  {
    id: 'modify-user-address',
    title: L('修改账户默认地址', 'Change the account\'s default address'),
    core: false,
    opening: L('我搬家了，想把账户里的默认收货地址改一下。', 'I\'ve moved and want to change the default shipping address on my account.'),
    instruction: L(
      `你叫孙丽，注册邮箱 sunli2024@example.com。你想把账户默认地址改成：江苏省南京市鼓楼区中山路 18 号，邮编 210008。已有订单不用改。${PERSONA}`,
      `Your name is Sun Li and your account email is sunli2024@example.com. You want to change your account's default address to: 18 Zhongshan Road, Gulou District, Nanjing, Jiangsu, zip code 210008. Existing orders don't need to change. ${PERSONA}`,
    ),
    expected: [{ tool: 'modify_user_address', args: { user_id: 'sun_li_1007', address: L('江苏省南京市鼓楼区中山路18号', '18 Zhongshan Road, Gulou District, Nanjing, Jiangsu'), zip: '210008' } }],
  },
  {
    id: 'order-status',
    title: L('查询物流单号', 'Look up a tracking number'),
    core: false,
    opening: L('我的台灯发货了吗？想要一下物流单号。', 'Has my desk lamp shipped? Can I get the tracking number?'),
    instruction: L(
      `你叫周杰，注册邮箱 zhoujie@example.com。你想知道订单 #W1024（护眼台灯）的状态和物流单号。客服告诉你后道谢结束对话，不需要办理其他业务。`,
      `Your name is Zhou Jie and your account email is zhoujie@example.com. You want to know the status and tracking number of order #W1024 (an eye-care desk lamp). Once the agent tells you, say thanks and end the conversation; you don't need anything else.`,
    ),
    expected: [],
    why: L('客户只是查询，不需要修改任何数据', 'the customer only asked a question; nothing needs to change'),
    mustSay: ['SF1234567890'],
  },
  {
    id: 'gift-card-balance',
    title: L('查询礼品卡余额', 'Check the gift card balance'),
    core: false,
    opening: L('我想查一下我的礼品卡还有多少钱。', 'I\'d like to check how much is left on my gift card.'),
    instruction: L(
      `你叫陈静，注册邮箱 chenjing@example.com。你只想知道礼品卡余额，知道后结束对话。`,
      `Your name is Chen Jing and your account email is chenjing@example.com. You only want to know your gift card balance; end the conversation once you know it.`,
    ),
    expected: [],
    why: L('客户只是查询，不需要修改任何数据', 'the customer only asked a question; nothing needs to change'),
    mustSay: ['1000'],
  },
  {
    id: 'cancel-and-return',
    title: L('取消一单 + 退货一单', 'Cancel one order + return another'),
    core: false,
    opening: L('你好，我想取消一个订单，再退一件衣服。', 'Hi, I\'d like to cancel an order and return a shirt.'),
    instruction: L(
      `你叫张伟，注册邮箱 zhangwei@example.com。两件事，一件办完再说下一件：1）取消待发货订单 #W1001（耳机），原因是不再需要；2）已签收订单 #W1002 里的红色T恤退货（同一订单里的保温杯不退），退款退到礼品卡。${PERSONA}`,
      `Your name is Zhang Wei and your account email is zhangwei@example.com. Two things; bring up the second only after the first is done: 1) cancel pending order #W1001 (the earbuds) because you no longer need it; 2) return the red T-shirt from delivered order #W1002 (keep the flask in the same order), with the refund going to your gift card. ${PERSONA}`,
    ),
    expected: [cancel('#W1001', NO_NEED), ret('#W1002', ['2101'], 'gift_card_1001')],
  },
  {
    id: 'find-order-by-product',
    title: L('不记得订单号', 'Doesn\'t remember the order number'),
    core: false,
    opening: L('我有个还没发货的订单，里面的保温杯想换成大一点的，订单号我忘了。', 'I have an order that hasn\'t shipped yet, and I\'d like a bigger size of the flask in it. I forgot the order number.'),
    instruction: L(
      `你叫赵磊，注册邮箱 zhaolei@example.com。你不记得订单号，只记得是一个还没发货、里面有保温杯（350ml 银色）的订单。你想把保温杯换成 500ml 银色，订单里的T恤不变。差价用原来的交通银行信用卡结算。${PERSONA}`,
      `Your name is Zhao Lei and your account email is zhaolei@example.com. You don't remember the order number; you only remember it hasn't shipped yet and contains a flask (350ml, silver). You want to change the flask to 500ml silver; the T-shirt in the order stays as is. The difference goes on the original Bank of Communications credit card. ${PERSONA}`,
    ),
    expected: [items('#W1017', ['2401'], ['2402'], 'credit_card_1006')],
  },
  {
    id: 'return-other-card',
    title: L('退款不能退到其他卡', 'Refund can\'t go to another card'),
    core: false,
    opening: L('订单 #W1008 的键盘我想退货，钱退到我另一张浦发的信用卡上。', 'I\'d like to return the keyboard from order #W1008 and get the refund on my other card, the SPD Bank credit card.'),
    instruction: L(
      `你叫赵磊，注册邮箱 zhaolei@example.com。你想退掉已签收订单 #W1008 的键盘，希望退款到浦发银行信用卡（尾号 9031）。如果客服说只能退回原支付方式，你就同意退回原来的交通银行信用卡（尾号 6620）。${PERSONA}`,
      `Your name is Zhao Lei and your account email is zhaolei@example.com. You want to return the keyboard from delivered order #W1008 and would like the refund on your SPD Bank credit card (ending 9031). If the agent says it can only go back to the original payment method, agree to refund it to the original Bank of Communications credit card (ending 6620). ${PERSONA}`,
    ),
    expected: [ret('#W1008', ['2501'], 'credit_card_1006')],
  },
  {
    id: 'cancel-reason-other',
    title: L('取消原因要落到政策选项', 'Map the cancel reason to a policy option'),
    core: false,
    opening: L('我在别家看到更便宜的了，订单 #W1014 帮我取消。', 'I found it cheaper somewhere else. Please cancel order #W1014.'),
    instruction: L(
      `你叫王芳，注册邮箱 wangfang@example.com。你想取消待发货订单 #W1014，因为在别家找到更便宜的。如果客服让你在“不再需要”和“误下单”之间选，就选“不再需要”。${PERSONA}`,
      `Your name is Wang Fang and your account email is wangfang@example.com. You want to cancel pending order #W1014 because you found it cheaper elsewhere. If the agent asks you to choose between "no longer needed" and "ordered by mistake", choose "no longer needed". ${PERSONA}`,
    ),
    expected: [cancel('#W1014', NO_NEED)],
  },
  {
    id: 'wrong-zip-then-correct',
    title: L('先报错邮编再更正', 'Wrong zip first, then corrected'),
    core: false,
    opening: L('我想改一下订单 #W1010 的收货地址。', 'I\'d like to change the shipping address on order #W1010.'),
    instruction: L(
      `你叫周杰，不记得邮箱，只能用姓名和邮编验证。你一开始会把邮编误说成 200002，客服说找不到时更正为 200001。你想把订单 #W1010 的收货地址改成：上海市浦东新区世纪大道 100 号，邮编 200120。${PERSONA}`,
      `Your name is Zhou Jie. You don't remember your email, so you can only verify with your name and zip code. At first you mistakenly give your zip code as 200002; correct it to 200001 when the agent says it can't find you. You want to change the shipping address of order #W1010 to: 100 Century Avenue, Pudong New Area, Shanghai, zip code 200120. ${PERSONA}`,
    ),
    expected: [address('#W1010', L('上海市浦东新区世纪大道100号', '100 Century Avenue, Pudong New Area, Shanghai'), '200120')],
  },
  {
    id: 'modify-payment',
    title: L('待发货订单改用礼品卡支付', 'Switch a pending order to gift card payment'),
    core: false,
    opening: L('订单 #W1015 我想改用礼品卡支付。', 'I\'d like to pay for order #W1015 with my gift card instead.'),
    instruction: L(
      `你叫陈静，注册邮箱 chenjing@example.com。你想把待发货订单 #W1015 的支付方式从信用卡改成礼品卡。${PERSONA}`,
      `Your name is Chen Jing and your account email is chenjing@example.com. You want to switch the payment method of pending order #W1015 from your credit card to your gift card. ${PERSONA}`,
    ),
    expected: [payment('#W1015', 'gift_card_1005')],
  },
  {
    id: 'payment-insufficient',
    title: L('拒绝：礼品卡余额不足', 'Refuse: not enough gift card balance'),
    core: false,
    opening: L('订单 #W1016 能改成用礼品卡付吗？', 'Can I switch order #W1016 to my gift card?'),
    instruction: L(
      `你叫孙丽，注册邮箱 sunli2024@example.com。你想把待发货订单 #W1016 改成用礼品卡支付。如果余额不够，就保持原来的支付宝不变，结束对话。`,
      `Your name is Sun Li and your account email is sunli2024@example.com. You want to switch pending order #W1016 to your gift card. If the balance isn't enough, keep the original Alipay payment and end the conversation.`,
    ),
    expected: [],
    why: L('礼品卡余额只有 20 元，不足以支付订单金额 239 元', 'the gift card balance is only ¥20, not enough for the ¥239 order total'),
  },
]

// —————————— 模拟用户脚本 ——————————

/** 中文版用原来的正则；英文版同时接受中文和英文的说法 */
const both = (zh: RegExp, en: RegExp) => L(zh, new RegExp(`${zh.source}|${en.source}`, 'i'))

const CONFIRM_REQ = both(
  /请确认|是否确认|确认请回复|确认吗|确认一下|请您确认|回复“是”|回复"是"/,
  /please confirm|can you confirm|could you confirm|do you confirm|to confirm|reply “?"?yes|(shall|should|may) I (go ahead|proceed)|would you like me to proceed/,
)
const DONE = both(/已为您|已经为您|已成功|已提交|已取消|已修改|已申请/, /\bI've\b|\bI have (now )?(cancel|chang|updat|submit|modif|process|request)|successfully|has been (cancel|updat|chang|submit|modif)/)
const REFUSAL = both(/无法|不能|不支持|不可以/, /\b(can't|cannot|can not|unable to|not able to|not possible|not eligible)\b/)
const NOT_FOUND = both(/没有找到|未找到|找不到|核对/, /couldn't find|could not find|no (user|account) found|not found|double-check/)
const ASK_ID = both(/邮箱|身份|姓名/, /\b(e-?mail|identity|verify|your name)\b/)
const ASK_ORDER = both(/订单号|哪个订单|哪一个订单/, /order (number|id)|which order/)
const ASK_REASON = both(/原因/, /reason/)
const ASK_ADDRESS = both(/地址/, /address/)
const ASK_PAY = both(/退款|退到|支付方式|付款方式|差价/, /refund|payment method|\bpay\b|price difference/)

const SAY = L(
  {
    repeated: '你已经第三次问我同样的问题了，我刚才不是说过了吗？算了。',
    confirm: '是的，确认。',
    thanks: '好的，谢谢！',
    giveUp: '好吧，那就算了。',
    corrected: '不好意思，我刚才说错了。',
    notFound: '我给的信息没错啊……算了，我晚点再来。',
    askedTooOften: '我已经说过好几次了，你们怎么一直问……算了。',
    orderNo: (id: string) => `订单号是 ${id}。`,
    confused: '你好像没明白我的意思，我先不办了。',
    repeat: (intro: string | undefined, id: string) => `我的问题是：${intro ?? '我开头说的那件事'}，订单号 ${id}。`,
  },
  {
    repeated: "That's the third time you've asked me the same thing. Didn't I just tell you? Forget it.",
    confirm: 'Yes, I confirm.',
    thanks: 'Great, thanks!',
    giveUp: 'Alright, never mind then.',
    corrected: 'Sorry, my mistake. ',
    notFound: "The details I gave you are correct... Forget it, I'll come back later.",
    askedTooOften: "I've already told you several times. Why do you keep asking... Forget it.",
    orderNo: (id: string) => `The order number is ${id}.`,
    confused: "You don't seem to understand what I mean. I'll leave it for now.",
    repeat: (intro: string | undefined, id: string) => `Like I said: ${intro ?? 'what I mentioned at the start'} The order number is ${id}.`,
  },
)

export function makeScript(spec: ScriptSpec): SimUserSpec['script'] {
  return (msg, _turn, memory) => {
    const m = memory as { req?: number; idAsks?: number; confused?: number; wrongGiven?: boolean; corrected?: boolean; seen?: Record<string, number> }
    // 客服反复说同一句话（例如每轮都忘了上下文、重新问订单号）：真人会失去耐心
    m.seen ??= {}
    m.seen[msg] = (m.seen[msg] ?? 0) + 1
    if (m.seen[msg] >= 3) return `${SAY.repeated}${STOP}`
    const req = spec.requests[m.req ?? 0]
    const id = req.orderId.replace('#', '')
    if (msg.includes(id) && CONFIRM_REQ.test(msg)) return SAY.confirm
    if (msg.includes(id) && DONE.test(msg)) {
      m.req = (m.req ?? 0) + 1
      m.confused = 0
      const next = spec.requests[m.req]
      return next ? next.intro! : `${SAY.thanks}${STOP}`
    }
    if (REFUSAL.test(msg)) return `${spec.onRefusal ?? SAY.giveUp}${STOP}`
    if (NOT_FOUND.test(msg)) {
      if (spec.wrongIdentity && m.wrongGiven && !m.corrected) {
        m.corrected = true
        return `${SAY.corrected}${spec.identity}`
      }
      return `${SAY.notFound}${STOP}`
    }
    if (ASK_ID.test(msg)) {
      m.idAsks = (m.idAsks ?? 0) + 1
      if (m.idAsks > 3) return `${SAY.askedTooOften}${STOP}`
      if (spec.wrongIdentity && !m.wrongGiven) {
        m.wrongGiven = true
        return spec.wrongIdentity
      }
      return spec.identity
    }
    if (ASK_ORDER.test(msg)) return req.orderText ?? SAY.orderNo(req.orderId)
    if (ASK_REASON.test(msg) && req.reason) return req.reason
    if (ASK_ADDRESS.test(msg) && req.address) return req.address
    if (ASK_PAY.test(msg) && req.payment) return req.payment
    m.confused = (m.confused ?? 0) + 1
    if (m.confused >= 3) return `${SAY.confused}${STOP}`
    return SAY.repeat(req.intro, req.orderId)
  }
}

export function userSpecOf(t: RetailTaskSpec): SimUserSpec {
  return { opening: t.opening, instruction: t.instruction, script: t.script ? makeScript(t.script) : () => STOP }
}

// —————————— 判定 ——————————

const CONFIRMED = /确认|是的|^\s*是|好的|可以|没问题|对的|同意|^\s*对|^\s*行|^\s*嗯/
const DENIED = /不(要|用|行|对|是|确认|同意|可以)|别|先不|等等|再想/
const zhConfirm = (text: string) => CONFIRMED.test(text) && !DENIED.test(text)
// English: an affirmative AND no negation aimed at the action. "no other changes" / "nothing else" / "no problem" are not refusals.
const EN_AFFIRM = /\b(yes|yeah|yep|sure|ok|okay|correct|confirm|confirmed|go ahead|please do|do it|sounds good|that's right)\b/i
const EN_NEGATE = /\b(don't|do not|not yet|wait|hold on|hold off|stop|cancel that|never ?mind|actually,? no)\b|^\W*no\b/i
const enConfirm = (text: string) => EN_AFFIRM.test(text) && !EN_NEGATE.test(text)

/** 客户这句话是否明确确认了（英文版也接受中文的说法） */
export const isConfirm = L(zhConfirm, (text: string) => zhConfirm(text) || enConfirm(text))

const fmtArgs = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
export const fmtAction = (a: { tool: string; args: Record<string, unknown> }) => `${a.tool}(${fmtArgs(a.args ?? {})})`
const fmtActions = (xs: { tool: string; args: Record<string, unknown> }[]) => xs.map(fmtAction).join(L('、', ', '))

const statusOf = (o?: Order) => (o ? L(`${STATUS_TEXT[o.status]}（${o.status}）`, o.status) : L('不存在', 'missing'))
const itemsOf = (o: Order) => o.items.map((i) => `${i.name}[${i.item_id} ${Object.values(i.options).join('/')}]`).join(L('、', ', '))
const addrOf = (a: { address: string; zip: string }) => L(`${a.address}，${a.zip}`, `${a.address}, ${a.zip}`)

/** 描述期望状态和实际状态的差异（最多两条） */
export function diffDb(exp: Db, act: Db): string {
  const out: string[] = []
  for (const id of Object.keys(exp.orders)) {
    const e = exp.orders[id]
    const a = act.orders[id]
    if (JSON.stringify(e) === JSON.stringify(a)) continue
    if (e.status !== a.status) out.push(L(`订单 ${id} 的状态应为“${statusOf(e)}”，实际是“${statusOf(a)}”`, `order ${id} should be "${statusOf(e)}" but is "${statusOf(a)}"`))
    else if (JSON.stringify(e.address) !== JSON.stringify(a.address))
      out.push(L(`订单 ${id} 的收货地址应为“${addrOf(e.address)}”，实际是“${addrOf(a.address)}”`, `order ${id} should ship to "${addrOf(e.address)}" but ships to "${addrOf(a.address)}"`))
    else if (JSON.stringify(e.items) !== JSON.stringify(a.items)) out.push(L(`订单 ${id} 的商品应为 ${itemsOf(e)}，实际是 ${itemsOf(a)}`, `order ${id} should contain ${itemsOf(e)} but contains ${itemsOf(a)}`))
    else if (e.cancel_reason !== a.cancel_reason) out.push(L(`订单 ${id} 的取消原因应为“${e.cancel_reason}”，实际是“${a.cancel_reason}”`, `order ${id} should have cancel reason "${e.cancel_reason}" but has "${a.cancel_reason}"`))
    else if (JSON.stringify(e.return) !== JSON.stringify(a.return))
      out.push(L(`订单 ${id} 的退货信息应为 ${JSON.stringify(e.return)}，实际是 ${JSON.stringify(a.return)}`, `order ${id} return should be ${JSON.stringify(e.return)} but is ${JSON.stringify(a.return)}`))
    else if (JSON.stringify(e.exchange) !== JSON.stringify(a.exchange))
      out.push(L(`订单 ${id} 的换货信息应为 ${JSON.stringify(e.exchange)}，实际是 ${JSON.stringify(a.exchange)}`, `order ${id} exchange should be ${JSON.stringify(e.exchange)} but is ${JSON.stringify(a.exchange)}`))
    else out.push(L(`订单 ${id} 的支付记录不一致（支付方式用错了？）`, `order ${id} payment history doesn't match (wrong payment method?)`))
  }
  for (const id of Object.keys(exp.users)) {
    const e = exp.users[id]
    const a = act.users[id]
    if (JSON.stringify(e) === JSON.stringify(a)) continue
    if (JSON.stringify(e.address) !== JSON.stringify(a.address))
      out.push(L(`用户 ${id} 的默认地址应为“${addrOf(e.address)}”，实际是“${addrOf(a.address)}”`, `user ${id} default address should be "${addrOf(e.address)}" but is "${addrOf(a.address)}"`))
    else out.push(L(`用户 ${id} 的支付方式（礼品卡余额）不一致`, `user ${id} payment methods (gift card balance) don't match`))
  }
  return out.slice(0, 2).join(L('；', '; '))
}

const mentions = (text: string, orderId: unknown) => typeof orderId === 'string' && text.includes(orderId.replace('#', ''))

function checkPolicy(actions: ActionRecord[]): string | null {
  for (const [i, a] of actions.entries()) {
    const n = L(`第 ${i + 1} 个写操作 ${fmtAction(a)}`, `Write #${i + 1} ${fmtAction(a)}`)
    if (!a.authUserId)
      return L(
        `${n} 发生在验证客户身份之前。政策要求先用邮箱或姓名 + 邮编验证身份（find_user_id_by_email / find_user_id_by_name_zip），再办理任何业务。把客服政策放进 system prompt，模型才知道这条规则。`,
        `${n} happened before the customer's identity was verified. The policy requires verifying identity by email or name + zip (find_user_id_by_email / find_user_id_by_name_zip) before doing anything. The model only knows this rule if you put the policy in the system prompt.`,
      )
    if (a.ownerId && a.ownerId !== a.authUserId)
      return L(
        `${n} 操作的是用户 ${a.ownerId} 的数据，但已验证的客户是 ${a.authUserId}。只能为已验证身份的客户本人办理业务。`,
        `${n} touched data belonging to user ${a.ownerId}, but the verified customer is ${a.authUserId}. You may only act for the verified customer themselves.`,
      )
    if (a.turn < 1 || !isConfirm(a.userText))
      return L(
        `${n} 执行前客户没有明确确认（客户最近一句话是：“${a.userText.slice(0, 40)}”）。政策要求写操作前先列出详情、等客户回复“是/确认”再执行：模型要先把确认问题发给客户，拿到回复后在下一轮再调用写工具。`,
        `${n} ran without the customer's explicit confirmation (their last message was: "${a.userText.slice(0, 60)}"). The policy requires listing the details and waiting for the customer to reply "yes" before any write: send the confirmation question to the customer, and call the write tool in the next turn, after they reply.`,
      )
    if (actions.some((b, j) => j < i && b.turn === a.turn))
      return L(
        `${n} 和上一个写操作共用了客户的同一次确认。政策要求一次确认只对应一个操作，第二个操作要重新列出详情、重新确认。`,
        `${n} reused the same customer confirmation as the previous write. The policy says one confirmation covers one action; list the details and ask again for the second one.`,
      )
    if (a.args?.order_id && !mentions(a.agentBefore, a.args.order_id))
      return L(
        `${n} 之前，请客户确认的那句话里没有提到订单号 ${a.args.order_id}。确认前要把操作详情（订单号、商品、金额、退款方式……）列给客户。`,
        `Before ${n}, the message asking the customer to confirm didn't mention order ${a.args.order_id}. List the details (order number, items, amounts, refund method...) before asking for confirmation.`,
      )
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
    return {
      pass: false,
      reason: L(
        `按政策这个请求不应该修改任何数据（${spec.why ?? '请求不符合政策'}），但执行了 ${fmtActions(st.actions)}。`,
        `Under the policy this request shouldn't change any data (${spec.why ?? "the request doesn't comply with the policy"}), but the agent ran ${fmtActions(st.actions)}.`,
      ),
    }

  const expected = freshDb()
  for (const a of writes) WRITE_OPS[a.tool](expected, structuredClone(a.args))
  const diff = diffDb(expected, st.db)
  if (diff) {
    if (!st.actions.length)
      return {
        pass: false,
        reason: L(
          `客户的请求没有办完：期望执行 ${fmtActions(writes)}，但对话结束时没有任何写操作（共 ${turns} 轮客户发言）。常见原因：只跑了一轮就结束；每一轮没有带上之前的对话历史，模型忘了客户是谁、要办什么；客户确认后没有继续执行。`,
          `The customer's request wasn't completed: expected ${fmtActions(writes)}, but the conversation ended without any write (${turns} customer messages). Common causes: stopping after one turn; not carrying the conversation history into each turn, so the model forgets who the customer is and what they want; not following through after the customer confirms.`,
        ),
      }
    return {
      pass: false,
      reason: L(
        `数据库最终状态和预期不一致：${diff}。期望的操作：${fmtActions(writes)}；实际执行：${fmtActions(st.actions)}`,
        `The final database state doesn't match: ${diff}. Expected: ${fmtActions(writes)}; actually ran: ${fmtActions(st.actions)}`,
      ),
    }
  }

  const wantsTransfer = spec.expected.some((a) => a.tool === 'transfer_to_human_agents')
  if (wantsTransfer && !st.transfers.length)
    return {
      pass: false,
      reason: L(
        '客户的请求超出了政策范围且客户坚持，应该调用 transfer_to_human_agents 转接人工客服。',
        'The request is outside the policy and the customer insists, so the agent should call transfer_to_human_agents.',
      ),
    }
  if (!wantsTransfer && st.transfers.length)
    return {
      pass: false,
      reason: L(
        '这个请求按政策可以直接办理（或直接说明不能办理），不应该转接人工客服。转人工只用于超出政策范围、且客户坚持的情况。',
        "This request can be handled (or declined) under the policy; it shouldn't be transferred to a human. Transfers are only for requests outside the policy where the customer insists.",
      ),
    }

  const said = st.user.transcript
    .filter((m) => m.role === 'agent')
    .map((m) => m.text)
    .join('\n')
  for (const fact of spec.mustSay ?? [])
    if (!said.includes(fact)) return { pass: false, reason: L(`没有把客户要的信息告诉客户：回复里应包含“${fact}”。`, `The agent didn't give the customer what they asked for: the replies should include "${fact}".`) }

  if (spec.expected.length)
    return { pass: true, reason: L(`完成：${spec.expected.map((a) => a.tool).join('、')}，流程合规，最终状态正确`, `Done: ${spec.expected.map((a) => a.tool).join(', ')}; process compliant, final state correct`) }
  return { pass: true, reason: L('没有违规修改数据，状态正确', 'No data changed in violation of the policy; state is correct') }
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
