/**
 * P3 的数据：拾光盒子（订阅制生活方式电商）的业务库。
 * 用固定种子的伪随机数生成，每次生成的数据完全一样；生成一次，缓存成一段建表 + 插入的 SQL。
 *
 * 故意保留了真实数仓里常见的“坑”：
 * - 金额字段（amt / unit_amt / refund_amt / list_price）的单位是分，campaigns.budget 却是元；
 * - 状态是数字码（orders.status）或英文（refunds.state），含义只写在数据字典里；
 * - customers.is_test 标记的内部测试账号会污染所有指标；
 * - orders_old 是迁移前的旧表快照：字段名更“友好”，但数据不完整、状态没同步、还有重复行。
 *
 * 英文版：数据完全相同（同一个种子、同样的行和数字），只是把文字值（昵称、城市、类目、商品名、活动名、旧表状态）翻译成英文。
 */
import { L } from '../../../engine/locale'

export const TODAY = '2026-03-15'

/** 表结构：[列名, 类型] */
export const TABLES: Record<string, [string, string][]> = {
  customers: [
    ['cust_id', 'INTEGER'],
    ['nick', 'TEXT'],
    ['city', 'TEXT'],
    ['tier', 'INTEGER'],
    ['reg_dt', 'TEXT'],
    ['is_test', 'INTEGER'],
  ],
  categories: [
    ['cat_id', 'INTEGER'],
    ['cat_name', 'TEXT'],
    ['parent_id', 'INTEGER'],
  ],
  products: [
    ['sku', 'TEXT'],
    ['title', 'TEXT'],
    ['cat_id', 'INTEGER'],
    ['list_price', 'INTEGER'],
    ['is_active', 'INTEGER'],
  ],
  campaigns: [
    ['campaign_id', 'INTEGER'],
    ['name', 'TEXT'],
    ['start_dt', 'TEXT'],
    ['end_dt', 'TEXT'],
    ['budget', 'INTEGER'],
  ],
  orders: [
    ['order_id', 'INTEGER'],
    ['cust_id', 'INTEGER'],
    ['created_at', 'TEXT'],
    ['status', 'INTEGER'],
    ['amt', 'INTEGER'],
    ['channel', 'TEXT'],
    ['campaign_id', 'INTEGER'],
  ],
  order_items: [
    ['order_id', 'INTEGER'],
    ['sku', 'TEXT'],
    ['qty', 'INTEGER'],
    ['unit_amt', 'INTEGER'],
  ],
  refunds: [
    ['refund_id', 'INTEGER'],
    ['order_id', 'INTEGER'],
    ['refund_amt', 'INTEGER'],
    ['refund_dt', 'TEXT'],
    ['state', 'TEXT'],
  ],
  sessions: [
    ['session_id', 'INTEGER'],
    ['cust_id', 'INTEGER'],
    ['ts', 'TEXT'],
    ['device', 'TEXT'],
  ],
  orders_old: [
    ['order_no', 'TEXT'],
    ['customer_id', 'INTEGER'],
    ['order_date', 'TEXT'],
    ['total_yuan', 'REAL'],
    ['status_text', 'TEXT'],
  ],
}

const PRIMARY: Record<string, string> = {
  customers: 'cust_id',
  categories: 'cat_id',
  products: 'sku',
  campaigns: 'campaign_id',
  orders: 'order_id',
  refunds: 'refund_id',
  sessions: 'session_id',
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
const dayOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(2, '0')

type Row = (string | number | null)[]

export interface SeedData {
  customers: Row[]
  categories: Row[]
  products: Row[]
  campaigns: Row[]
  orders: Row[]
  order_items: Row[]
  refunds: Row[]
  sessions: Row[]
  orders_old: Row[]
}

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘蒋蔡余杜叶程魏苏吕丁任沈姚卢钟姜崔谭陆范汪廖石金韦贾夏付方邹熊白孟秦邱侯江尹薛闫段雷龙黎史陶贺毛郝顾龚邵万覃武钱戴严莫孔向常汤康易乔赖文'
const GIVEN = ['子涵', '欣怡', '梓轩', '雨桐', '浩然', '诗琪', '一诺', '思远', '晓彤', '嘉豪', '若曦', '俊杰', '佳怡', '宇航', '梦瑶', '明轩', '可馨', '天佑', '语嫣', '博文', '静怡', '泽宇', '安然', '晨阳']
const CITIES: [string, number][] = [
  ['上海', 22],
  ['杭州', 16],
  ['北京', 15],
  ['深圳', 12],
  ['成都', 10],
  ['南京', 9],
  ['广州', 9],
  ['武汉', 7],
]

const CATEGORIES: Row[] = [
  [1, '咖啡', null],
  [2, '茶饮', null],
  [3, '零食', null],
  [4, '器具', null],
  [5, '咖啡豆', 1],
  [6, '挂耳咖啡', 1],
  [7, '胶囊咖啡', 1],
  [8, '绿茶', 2],
  [9, '乌龙茶', 2],
  [10, '花草茶', 2],
  [11, '坚果', 3],
  [12, '饼干', 3],
  [13, '手冲器具', 4],
  [14, '杯具', 4],
]

const PRODUCTS: [string, number, number][] = [
  ['云南小粒咖啡豆 500g', 5, 8900],
  ['埃塞俄比亚耶加雪菲 250g', 5, 12800],
  ['哥伦比亚慧兰 250g', 5, 9800],
  ['意式拼配豆 1kg', 5, 15900],
  ['挂耳咖啡 · 经典 10 片', 6, 4900],
  ['挂耳咖啡 · 果香 10 片', 6, 5900],
  ['冷萃挂耳 8 片', 6, 4500],
  ['胶囊咖啡 · 浓缩 20 颗', 7, 9900],
  ['胶囊咖啡 · 燕麦拿铁 10 颗', 7, 6900],
  ['明前龙井 100g', 8, 16800],
  ['碧螺春 100g', 8, 12800],
  ['安吉白茶 100g', 8, 13800],
  ['铁观音 150g', 9, 9800],
  ['大红袍 150g', 9, 15800],
  ['蜜桃乌龙冷泡茶 12 包', 9, 3900],
  ['洋甘菊花草茶', 10, 3500],
  ['玫瑰荔枝花果茶', 10, 4200],
  ['每日坚果 30 袋', 11, 12900],
  ['夏威夷果 500g', 11, 6800],
  ['碧根果 400g', 11, 5900],
  ['黄油曲奇礼盒', 12, 7900],
  ['全麦苏打饼干', 12, 2900],
  ['手冲壶 600ml', 13, 19900],
  ['V60 滤杯套装', 13, 12900],
  ['手摇磨豆机', 13, 29900],
  ['滤纸 100 张', 13, 2500],
  ['双层玻璃杯 350ml', 14, 6900],
  ['随行保温杯 480ml', 14, 15900],
  ['陶瓷马克杯', 14, 4900],
  ['冰滴壶', 13, 25900],
]

const CAMPAIGNS: Row[] = [
  [1, '夏日冰咖', '2025-07-01', '2025-07-31', 3000],
  [2, '双11狂欢', '2025-11-01', '2025-11-11', 8000],
  [3, '双12返场', '2025-12-10', '2025-12-12', 2000],
  [4, '新春年货节', '2026-01-15', '2026-02-10', 6000],
  [5, '38女神节', '2026-03-01', '2026-03-08', 4000],
]

const OLD_STATUS: Record<number, string> = { 1: '待支付', 2: '已支付', 3: '已发货', 4: '已完成', 9: '已取消' }

function generate(): SeedData {
  const rng = mulberry32(20260315)
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)]
  const weighted = <T>(xs: [T, number][]) => {
    let r = rng() * xs.reduce((n, [, w]) => n + w, 0)
    for (const [x, w] of xs) if ((r -= w) < 0) return x
    return xs[xs.length - 1][0]
  }

  // —— 客户：1..150 正常客户（注册日期互不相同），151..156 测试账号，157..160 正常客户 ——
  const start = dayOf('2024-01-01')
  const offsets = Array.from({ length: 790 }, (_, i) => i)
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[offsets[i], offsets[j]] = [offsets[j], offsets[i]]
  }
  const names = new Set<string>(['林小满'])
  const customers: Row[] = []
  for (let id = 1; id <= 160; id++) {
    const isTest = id >= 151 && id <= 156
    let nick: string
    if (id === 7) nick = '林小满'
    else if (isTest) nick = `测试账号${pad(id - 150)}`
    else {
      do nick = pick([...SURNAMES]) + pick(GIVEN)
      while (names.has(nick))
      names.add(nick)
    }
    const reg = isTest ? `2025-03-${pad(id - 148)}` : isoDay(start + offsets[id] * DAY)
    const tier = isTest ? 2 : weighted<number>([
      [0, 70],
      [1, 20],
      [2, 10],
    ])
    customers.push([id, nick, isTest ? '杭州' : weighted(CITIES), tier, reg, isTest ? 1 : 0])
  }
  const regOf = new Map(customers.map((c) => [c[0] as number, c[4] as string]))

  const products: Row[] = PRODUCTS.map(([title, cat, price], i) => [`SKU-${1001 + i}`, title, cat, price, rng() < 0.83 ? 1 : 0])

  // —— 订单：2025-01-01 ~ 2026-03-15，越往后越多 ——
  const first = dayOf('2025-01-01')
  const last = dayOf(TODAY)
  const totalDays = (last - first) / DAY + 1
  const orders: Row[] = []
  const items: Row[] = []
  const refunds: Row[] = []
  let orderId = 10001
  let refundId = 1
  const buyers = customers.filter((c) => c[0] !== 7).map((c) => c[0] as number)
  for (let d = 0; d < totalDays; d++) {
    const date = isoDay(first + d * DAY)
    const n = Math.floor(rng() * (2 + (3 * d) / totalDays)) + (rng() < 0.4 ? 1 : 0)
    for (let k = 0; k < n; k++) {
      // 林小满每隔一段时间买一次；测试账号在 2025-04 之后偶尔下单；其余客户只能在注册之后下单
      let cust: number
      if (d % 90 === 5 && k === 0) cust = 7
      else if (d > 90 && rng() < 0.05) cust = 151 + Math.floor(rng() * 6)
      else {
        do cust = pick(buyers)
        while (regOf.get(cust)! > date && !(cust >= 151 && cust <= 156))
      }
      const time = `${date} ${pad(8 + Math.floor(rng() * 15))}:${pad(Math.floor(rng() * 60))}:${pad(Math.floor(rng() * 60))}`
      const age = (last - dayOf(date)) / DAY
      let status: number
      if (age <= 2) status = rng() < 0.75 ? 2 : 1
      else if (age <= 9) status = weighted<number>([
        [2, 20],
        [3, 60],
        [4, 10],
        [9, 10],
      ])
      else status = weighted<number>([
        [4, 80],
        [9, 13],
        [1, 4],
        [3, 3],
      ])
      const campaign = CAMPAIGNS.find((c) => date >= (c[2] as string) && date <= (c[3] as string))
      const campaignId = campaign && rng() < 0.6 ? (campaign[0] as number) : null
      const channel = weighted<string>([
        ['app', 50],
        ['mini', 30],
        ['web', 20],
      ])
      const lines = 1 + Math.floor(rng() * 3)
      const chosen = new Set<number>()
      while (chosen.size < lines) chosen.add(Math.floor(rng() * PRODUCTS.length))
      let gross = 0
      for (const p of chosen) {
        const qty = 1 + Math.floor(rng() * 3)
        const price = PRODUCTS[p][2]
        const unit = rng() < 0.3 ? Math.round((price * 0.9) / 10) * 10 : price
        gross += qty * unit
        items.push([orderId, `SKU-${1001 + p}`, qty, unit])
      }
      const coupon = campaignId ? pick([0, 1000, 2000]) : rng() < 0.1 ? 500 : 0
      const amt = Math.max(100, gross - coupon)
      orders.push([orderId, cust, time, status, amt, channel, campaignId])
      if ([2, 3, 4].includes(status) && rng() < 0.12) {
        const full = rng() < 0.5
        const refundDay = Math.min(last, dayOf(date) + (3 + Math.floor(rng() * 12)) * DAY)
        refunds.push([
          refundId++,
          orderId,
          full ? amt : Math.max(100, Math.round((amt * (0.2 + rng() * 0.5)) / 100) * 100),
          isoDay(refundDay),
          weighted<string>([
            ['approved', 68],
            ['rejected', 20],
            ['pending', 12],
          ]),
        ])
      }
      orderId++
    }
  }

  // —— 会话：2025-12-01 ~ 2026-03-15 ——
  const sessions: Row[] = []
  const sFirst = dayOf('2025-12-01')
  const sDays = (last - sFirst) / DAY + 1
  const regular = customers.filter((c) => !c[5]).map((c) => c[0] as number)
  // 一部分客户是“沉睡用户”，只在 12 月出现过
  const sleepy = new Set(regular.filter(() => rng() < 0.35))
  let sid = 1
  for (let d = 0; d < sDays; d++) {
    const date = isoDay(sFirst + d * DAY)
    const n = 10 + Math.floor(rng() * 10)
    for (let k = 0; k < n; k++) {
      let cust: number
      if (rng() < 0.06) cust = 151 + Math.floor(rng() * 6)
      else {
        cust = pick(regular)
        if (sleepy.has(cust) && d > 30) continue
        if (regOf.get(cust)! > date) continue
      }
      const ts = `${date} ${pad(7 + Math.floor(rng() * 16))}:${pad(Math.floor(rng() * 60))}:${pad(Math.floor(rng() * 60))}`
      sessions.push([sid++, cust, ts, weighted<string>([
        ['ios', 45],
        ['android', 40],
        ['web', 15],
      ])])
    }
  }

  // —— 旧订单表：2025-06-20 迁移时的快照（状态没同步、金额是元、还有几行重复） ——
  const snapshot = dayOf('2025-06-20')
  const orders_old: Row[] = []
  for (const o of orders) {
    const created = o[2] as string
    if (created >= '2025-06-20') continue
    const age = (snapshot - dayOf(created)) / DAY
    let status = o[3] as number
    if (age <= 12 && status === 4) status = 3
    const row: Row = [`O${o[0]}`, o[1], created.slice(0, 10), (o[4] as number) / 100, OLD_STATUS[status]]
    orders_old.push(row)
    if (rng() < 0.03) orders_old.push([...row])
  }

  return { customers, categories: CATEGORIES, products, campaigns: CAMPAIGNS, orders, order_items: items, refunds, sessions, orders_old }
}

const lit = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)

function toSql(data: SeedData): string {
  const out: string[] = ['BEGIN;']
  for (const [name, cols] of Object.entries(TABLES)) {
    const defs = cols.map(([c, t]) => `${c} ${t}${PRIMARY[name] === c ? ' PRIMARY KEY' : ''}`)
    out.push(`CREATE TABLE ${name} (${defs.join(', ')});`)
    const rows = data[name as keyof SeedData]
    for (let i = 0; i < rows.length; i += 200)
      out.push(`INSERT INTO ${name} VALUES ${rows.slice(i, i + 200).map((r) => `(${r.map(lit).join(', ')})`).join(', ')};`)
  }
  out.push('COMMIT;')
  return out.join('\n')
}

// —————————————— 英文版：只翻译文字值，行和数字完全不变 ——————————————

const SURNAMES_EN = 'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Gao Luo Zheng Liang Xie Song Tang Xu Han Feng Deng Cao Peng Zeng Xiao Tian Dong Yuan Pan Jiang Cai Yu Du Ye Cheng Wei Su Lyu Ding Ren Shen Yao Lu Zhong Jiang Cui Tan Lu Fan Wang Liao Shi Jin Wei Jia Xia Fu Fang Zou Xiong Bai Meng Qin Qiu Hou Jiang Yin Xue Yan Duan Lei Long Li Shi Tao He Mao Hao Gu Gong Shao Wan Qin Wu Qian Dai Yan Mo Kong Xiang Chang Tang Kang Yi Qiao Lai Wen'.split(' ')
const GIVEN_EN = ['Zihan', 'Xinyi', 'Zixuan', 'Yutong', 'Haoran', 'Shiqi', 'Yinuo', 'Siyuan', 'Xiaotong', 'Jiahao', 'Ruoxi', 'Junjie', 'Jiayi', 'Yuhang', 'Mengyao', 'Mingxuan', 'Kexin', 'Tianyou', 'Yuyan', 'Bowen', 'Jingyi', 'Zeyu', 'Anran', 'Chenyang']
const CITIES_EN: Record<string, string> = { 上海: 'Shanghai', 杭州: 'Hangzhou', 北京: 'Beijing', 深圳: 'Shenzhen', 成都: 'Chengdu', 南京: 'Nanjing', 广州: 'Guangzhou', 武汉: 'Wuhan' }
const CATEGORIES_EN = ['Coffee', 'Tea', 'Snacks', 'Brewing Gear', 'Coffee Beans', 'Drip Bags', 'Coffee Capsules', 'Green Tea', 'Oolong Tea', 'Herbal Tea', 'Nuts', 'Biscuits', 'Pour-Over Gear', 'Cups & Mugs']
const PRODUCTS_EN = [
  'Yunnan Arabica Beans 500g',
  'Ethiopia Yirgacheffe 250g',
  'Colombia Huila 250g',
  'Espresso Blend 1kg',
  'Drip Bags · Classic ×10',
  'Drip Bags · Fruity ×10',
  'Cold Brew Drip Bags ×8',
  'Coffee Capsules · Espresso ×20',
  'Coffee Capsules · Oat Latte ×10',
  'Pre-Qingming Longjing 100g',
  'Biluochun 100g',
  'Anji White Tea 100g',
  'Tieguanyin 150g',
  'Da Hong Pao 150g',
  'Peach Oolong Cold Brew ×12',
  'Chamomile Herbal Tea',
  'Rose Lychee Fruit Tea',
  'Daily Nuts ×30',
  'Macadamia Nuts 500g',
  'Pecans 400g',
  'Butter Cookie Gift Box',
  'Whole Wheat Crackers',
  'Pour-Over Kettle 600ml',
  'V60 Dripper Set',
  'Hand Coffee Grinder',
  'Paper Filters ×100',
  'Double-Wall Glass 350ml',
  'Travel Tumbler 480ml',
  'Ceramic Mug',
  'Cold Drip Tower',
]
const CAMPAIGNS_EN = ['Summer Iced Coffee', 'Singles Day', 'Double 12 Encore', 'Lunar New Year Sale', "Women's Day"]
const OLD_STATUS_EN: Record<string, string> = { 待支付: 'pending', 已支付: 'paid', 已发货: 'shipped', 已完成: 'completed', 已取消: 'cancelled' }

const tr = (map: Record<string, string>, v: unknown) => {
  const hit = map[String(v)]
  if (hit === undefined) throw new Error(`missing English text for ${String(v)}`)
  return hit
}

function nickEn(nick: string): string {
  if (nick === '林小满') return 'Lin Xiaoman'
  const test = /^测试账号(\d+)$/.exec(nick)
  if (test) return `Test Account ${test[1]}`
  return `${SURNAMES_EN[[...SURNAMES].indexOf(nick[0])]} ${GIVEN_EN[GIVEN.indexOf(nick.slice(1))]}`
}

function toEnglish(d: SeedData): SeedData {
  const byIndex = (zh: Row[], en: string[], col: number) => Object.fromEntries(zh.map((r, i) => [String(r[col]), en[i]]))
  const cats = byIndex(CATEGORIES, CATEGORIES_EN, 1)
  const titles = Object.fromEntries(PRODUCTS.map(([t], i) => [t, PRODUCTS_EN[i]]))
  const camps = byIndex(CAMPAIGNS, CAMPAIGNS_EN, 1)
  return {
    ...d,
    customers: d.customers.map(([id, nick, city, ...rest]) => [id, nickEn(String(nick)), tr(CITIES_EN, city), ...rest]),
    categories: d.categories.map(([id, name, parent]) => [id, tr(cats, name), parent]),
    products: d.products.map(([sku, title, ...rest]) => [sku, tr(titles, title), ...rest]),
    campaigns: d.campaigns.map(([id, name, ...rest]) => [id, tr(camps, name), ...rest]),
    orders_old: d.orders_old.map((r) => [...r.slice(0, 4), tr(OLD_STATUS_EN, r[4])]),
  }
}

let cache: { data: SeedData; sql: string } | undefined

/** 生成（并缓存）种子数据 */
export function seed(): { data: SeedData; sql: string } {
  if (!cache) {
    const zh = generate()
    const data = L(zh, toEnglish(zh))
    cache = { data, sql: toSql(data) }
  }
  return cache
}
