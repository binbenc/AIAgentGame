/** 优品商城的数据库：用户、订单、商品。仿照 τ-bench retail 领域，规模缩小、改成中文场景。 */
import { L } from '../../../engine/locale'

export interface Address {
  /** 完整地址（省市区 + 街道门牌），存储时去掉空白 */
  address: string
  zip: string
}

export interface PaymentMethod {
  id: string
  source: 'credit_card' | 'gift_card' | 'alipay'
  /** 给人看的说明，例如“招商银行信用卡（尾号 4421）” */
  label: string
  /** 礼品卡余额（元） */
  balance?: number
}

export interface User {
  user_id: string
  name: string
  email: string
  address: Address
  payment_methods: PaymentMethod[]
  orders: string[]
}

export interface Variant {
  item_id: string
  options: Record<string, string>
  price: number
  available: boolean
}

export interface Product {
  product_id: string
  name: string
  variants: Variant[]
}

export interface OrderItem {
  item_id: string
  product_id: string
  name: string
  options: Record<string, string>
  price: number
}

export type OrderStatus = 'pending' | 'processed' | 'delivered' | 'cancelled' | 'return requested' | 'exchange requested'

export interface Payment {
  type: 'payment' | 'refund'
  amount: number
  payment_method_id: string
}

export interface Order {
  order_id: string
  user_id: string
  status: OrderStatus
  address: Address
  items: OrderItem[]
  payment_history: Payment[]
  tracking?: string
  items_modified?: boolean
  cancel_reason?: string
  return?: { item_ids: string[]; payment_method_id: string }
  exchange?: { item_ids: string[]; new_item_ids: string[]; payment_method_id: string; price_difference: number }
}

export interface Db {
  users: Record<string, User>
  orders: Record<string, Order>
  products: Record<string, Product>
}

export const STATUS_TEXT: Record<OrderStatus, string> = L(
  {
    pending: '待发货',
    processed: '已发货（运输中）',
    delivered: '已签收',
    cancelled: '已取消',
    'return requested': '退货处理中',
    'exchange requested': '换货处理中',
  },
  {
    pending: 'pending (not shipped yet)',
    processed: 'shipped (in transit)',
    delivered: 'delivered',
    cancelled: 'cancelled',
    'return requested': 'return in progress',
    'exchange requested': 'exchange in progress',
  },
)

/** English names for product names, option keys and option values (the tables below are written in Chinese) */
const EN: Record<string, string> = {
  纯棉T恤: 'Cotton T-Shirt',
  降噪蓝牙耳机: 'Bluetooth Earbuds',
  轻跑跑步鞋: 'Lite Running Shoes',
  真空保温杯: 'Vacuum Flask',
  机械键盘: 'Mechanical Keyboard',
  通勤双肩包: 'Commuter Backpack',
  护眼台灯: 'Eye-Care Desk Lamp',
  瑜伽垫: 'Yoga Mat',
  颜色: 'color',
  尺码: 'size',
  降噪: 'noise cancelling',
  容量: 'capacity',
  轴体: 'switch',
  背光: 'backlight',
  功率: 'power',
  厚度: 'thickness',
  红色: 'red',
  黑色: 'black',
  蓝色: 'blue',
  白色: 'white',
  银色: 'silver',
  粉色: 'pink',
  灰色: 'gray',
  紫色: 'purple',
  绿色: 'green',
  主动降噪: 'active',
  无降噪: 'none',
  红轴: 'red',
  青轴: 'blue',
  茶轴: 'brown',
  有: 'yes',
  无: 'no',
}
const tr = (s: string) => L(s, EN[s] ?? s)

// —————————— 商品 ——————————

type V = [item_id: string, options: Record<string, string>, price: number, available: boolean]
const product = (product_id: string, name: string, variants: V[]): Product => ({
  product_id,
  name: tr(name),
  variants: variants.map(([item_id, options, price, available]) => ({
    item_id,
    options: Object.fromEntries(Object.entries(options).map(([k, v]) => [tr(k), tr(v)])),
    price,
    available,
  })),
})

const PRODUCTS: Product[] = [
  product('8310', '纯棉T恤', [
    ['2101', { 颜色: '红色', 尺码: 'M' }, 99, true],
    ['2102', { 颜色: '红色', 尺码: 'L' }, 99, false],
    ['2103', { 颜色: '黑色', 尺码: 'M' }, 99, true],
    ['2104', { 颜色: '黑色', 尺码: 'L' }, 99, true],
    ['2105', { 颜色: '蓝色', 尺码: 'M' }, 109, true],
    ['2106', { 颜色: '蓝色', 尺码: 'L' }, 109, true],
  ]),
  product('8320', '降噪蓝牙耳机', [
    ['2201', { 颜色: '白色', 降噪: '主动降噪' }, 599, true],
    ['2202', { 颜色: '黑色', 降噪: '主动降噪' }, 599, true],
    ['2203', { 颜色: '白色', 降噪: '无降噪' }, 399, true],
    ['2204', { 颜色: '黑色', 降噪: '无降噪' }, 399, false],
  ]),
  product('8330', '轻跑跑步鞋', [
    ['2301', { 尺码: '41', 颜色: '白色' }, 459, true],
    ['2302', { 尺码: '42', 颜色: '白色' }, 459, true],
    ['2303', { 尺码: '41', 颜色: '黑色' }, 469, true],
    ['2304', { 尺码: '42', 颜色: '黑色' }, 469, false],
    ['2305', { 尺码: '43', 颜色: '白色' }, 459, true],
  ]),
  product('8340', '真空保温杯', [
    ['2401', { 容量: '350ml', 颜色: '银色' }, 129, true],
    ['2402', { 容量: '500ml', 颜色: '银色' }, 149, true],
    ['2403', { 容量: '350ml', 颜色: '粉色' }, 129, true],
    ['2404', { 容量: '500ml', 颜色: '粉色' }, 149, false],
  ]),
  product('8350', '机械键盘', [
    ['2501', { 轴体: '红轴', 背光: '有' }, 399, true],
    ['2502', { 轴体: '青轴', 背光: '有' }, 399, true],
    ['2503', { 轴体: '茶轴', 背光: '有' }, 419, true],
    ['2504', { 轴体: '红轴', 背光: '无' }, 329, true],
    ['2505', { 轴体: '茶轴', 背光: '无' }, 349, false],
  ]),
  product('8360', '通勤双肩包', [
    ['2601', { 颜色: '黑色', 容量: '20L' }, 259, true],
    ['2602', { 颜色: '黑色', 容量: '30L' }, 299, true],
    ['2603', { 颜色: '灰色', 容量: '20L' }, 259, false],
    ['2604', { 颜色: '灰色', 容量: '30L' }, 299, true],
  ]),
  product('8370', '护眼台灯', [
    ['2701', { 颜色: '白色', 功率: '12W' }, 199, true],
    ['2702', { 颜色: '白色', 功率: '18W' }, 239, true],
    ['2703', { 颜色: '黑色', 功率: '12W' }, 199, true],
  ]),
  product('8380', '瑜伽垫', [
    ['2801', { 厚度: '6mm', 颜色: '紫色' }, 89, true],
    ['2802', { 厚度: '10mm', 颜色: '紫色' }, 109, true],
    ['2803', { 厚度: '6mm', 颜色: '绿色' }, 89, true],
    ['2804', { 厚度: '10mm', 颜色: '绿色' }, 109, false],
  ]),
]

// —————————— 用户 ——————————

const BANK_EN: Record<string, string> = {
  招商银行: 'China Merchants Bank',
  工商银行: 'ICBC',
  建设银行: 'CCB',
  中国银行: 'Bank of China',
  交通银行: 'Bank of Communications',
  浦发银行: 'SPD Bank',
  平安银行: 'Ping An Bank',
}
const cc = (id: string, bank: string, last4: string): PaymentMethod => ({
  id,
  source: 'credit_card',
  label: L(`${bank}信用卡（尾号 ${last4}）`, `${BANK_EN[bank]} credit card (ending ${last4})`),
})
const gift = (id: string, balance: number): PaymentMethod => ({ id, source: 'gift_card', label: L('优品礼品卡', 'Youpin gift card'), balance })
const alipay = (id: string): PaymentMethod => ({ id, source: 'alipay', label: L('支付宝', 'Alipay') })

const USERS: Omit<User, 'orders'>[] = [
  { user_id: 'zhang_wei_1001', name: L('张伟', 'Zhang Wei'), email: 'zhangwei@example.com', address: { address: L('上海市黄浦区南京东路100号', '100 East Nanjing Road, Huangpu District, Shanghai'), zip: '200001' }, payment_methods: [cc('credit_card_1001', '招商银行', '4421'), gift('gift_card_1001', 300)] },
  { user_id: 'li_na_1002', name: L('李娜', 'Li Na'), email: 'lina88@example.com', address: { address: L('北京市朝阳区建国路88号', '88 Jianguo Road, Chaoyang District, Beijing'), zip: '100020' }, payment_methods: [alipay('alipay_1002'), gift('gift_card_1002', 50)] },
  { user_id: 'wang_fang_1003', name: L('王芳', 'Wang Fang'), email: 'wangfang@example.com', address: { address: L('浙江省杭州市西湖区文三路20号', '20 Wensan Road, Xihu District, Hangzhou, Zhejiang'), zip: '310000' }, payment_methods: [cc('credit_card_1003', '工商银行', '8890'), gift('gift_card_1003', 500)] },
  { user_id: 'liu_yang_1004', name: L('刘洋', 'Liu Yang'), email: 'liuyang@example.com', address: { address: L('广东省深圳市南山区科技园路1号', '1 Science Park Road, Nanshan District, Shenzhen, Guangdong'), zip: '518000' }, payment_methods: [alipay('alipay_1004'), cc('credit_card_1004', '建设银行', '3307')] },
  { user_id: 'chen_jing_1005', name: L('陈静', 'Chen Jing'), email: 'chenjing@example.com', address: { address: L('四川省成都市武侯区天府大道66号', '66 Tianfu Avenue, Wuhou District, Chengdu, Sichuan'), zip: '610000' }, payment_methods: [gift('gift_card_1005', 1000), cc('credit_card_1005', '中国银行', '5512')] },
  { user_id: 'zhao_lei_1006', name: L('赵磊', 'Zhao Lei'), email: 'zhaolei@example.com', address: { address: L('湖北省武汉市洪山区珞喻路8号', '8 Luoyu Road, Hongshan District, Wuhan, Hubei'), zip: '430000' }, payment_methods: [cc('credit_card_1006', '交通银行', '6620'), cc('credit_card_1006b', '浦发银行', '9031')] },
  { user_id: 'sun_li_1007', name: L('孙丽', 'Sun Li'), email: 'sunli2024@example.com', address: { address: L('江苏省南京市玄武区北京东路5号', '5 East Beijing Road, Xuanwu District, Nanjing, Jiangsu'), zip: '210000' }, payment_methods: [alipay('alipay_1007'), gift('gift_card_1007', 20)] },
  { user_id: 'zhou_jie_1008', name: L('周杰', 'Zhou Jie'), email: 'zhoujie@example.com', address: { address: L('上海市静安区南京西路200号', '200 West Nanjing Road, Jing\'an District, Shanghai'), zip: '200001' }, payment_methods: [cc('credit_card_1008', '平安银行', '7745')] },
]

// —————————— 订单 ——————————

const VARIANTS = new Map(PRODUCTS.flatMap((p) => p.variants.map((v) => [v.item_id, { p, v }] as const)))

function item(id: string): OrderItem {
  const { p, v } = VARIANTS.get(id)!
  return { item_id: id, product_id: p.product_id, name: p.name, options: { ...v.options }, price: v.price }
}

function order(order_id: string, user_id: string, status: OrderStatus, items: string[], payment: string, extra: Partial<Order> = {}): Order {
  const user = USERS.find((u) => u.user_id === user_id)!
  const its = items.map(item)
  const total = its.reduce((n, i) => n + i.price, 0)
  const payment_history: Payment[] = [{ type: 'payment', amount: total, payment_method_id: payment }]
  if (status === 'cancelled') payment_history.push({ type: 'refund', amount: total, payment_method_id: payment })
  return { order_id, user_id, status, address: { ...user.address }, items: its, payment_history, ...extra }
}

const ORDERS: Order[] = [
  order('#W1001', 'zhang_wei_1001', 'pending', ['2201'], 'credit_card_1001'),
  order('#W1002', 'zhang_wei_1001', 'delivered', ['2101', '2403'], 'credit_card_1001', { tracking: 'SF8800112233' }),
  order('#W1003', 'zhang_wei_1001', 'cancelled', ['2701'], 'credit_card_1001', { cancel_reason: L('不再需要', 'no longer needed') }),
  order('#W1004', 'li_na_1002', 'pending', ['2401', '2801'], 'alipay_1002'),
  order('#W1005', 'wang_fang_1003', 'pending', ['2103', '2601'], 'credit_card_1003'),
  order('#W1006', 'chen_jing_1005', 'delivered', ['2203', '2701'], 'credit_card_1005', { tracking: 'YT5500667788' }),
  order('#W1007', 'liu_yang_1004', 'delivered', ['2301'], 'alipay_1004', { tracking: 'ZT3300445566' }),
  order('#W1008', 'zhao_lei_1006', 'delivered', ['2501'], 'credit_card_1006', { tracking: 'SF8800998877' }),
  order('#W1009', 'sun_li_1007', 'pending', ['2803'], 'alipay_1007'),
  order('#W1010', 'zhou_jie_1008', 'pending', ['2602'], 'credit_card_1008'),
  order('#W1011', 'zhou_jie_1008', 'pending', ['2402'], 'credit_card_1008'),
  order('#W1012', 'zhang_wei_1001', 'processed', ['2503'], 'credit_card_1001', { tracking: 'JD0011223344' }),
  order('#W1013', 'li_na_1002', 'delivered', ['2303'], 'gift_card_1002', { tracking: 'YD7700112233' }),
  order('#W1014', 'wang_fang_1003', 'pending', ['2202'], 'credit_card_1003'),
  order('#W1015', 'chen_jing_1005', 'pending', ['2402'], 'credit_card_1005'),
  order('#W1016', 'sun_li_1007', 'pending', ['2702'], 'alipay_1007'),
  order('#W1017', 'zhao_lei_1006', 'pending', ['2105', '2401'], 'credit_card_1006'),
  order('#W1018', 'zhang_wei_1001', 'pending', ['2101'], 'gift_card_1001'),
  order('#W1019', 'li_na_1002', 'delivered', ['2802', '2703'], 'alipay_1002', { tracking: 'SF8800334455' }),
  order('#W1020', 'zhou_jie_1008', 'pending', ['2203'], 'credit_card_1008'),
  order('#W1021', 'wang_fang_1003', 'delivered', ['2504', '2305'], 'gift_card_1003', { tracking: 'ZT3300778899' }),
  order('#W1022', 'liu_yang_1004', 'pending', ['2801'], 'alipay_1004'),
  order('#W1023', 'chen_jing_1005', 'processed', ['2604'], 'credit_card_1005', { tracking: 'YT5500112244' }),
  order('#W1024', 'zhou_jie_1008', 'processed', ['2701'], 'credit_card_1008', { tracking: 'SF1234567890' }),
]

const SEED: Db = {
  products: Object.fromEntries(PRODUCTS.map((p) => [p.product_id, p])),
  users: Object.fromEntries(USERS.map((u) => [u.user_id, { ...u, orders: ORDERS.filter((o) => o.user_id === u.user_id).map((o) => o.order_id) }])),
  orders: Object.fromEntries(ORDERS.map((o) => [o.order_id, o])),
}

/** 每个任务（每次试验）一份全新的深拷贝 */
export function freshDb(): Db {
  return structuredClone(SEED)
}
