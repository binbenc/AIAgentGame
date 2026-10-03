/**
 * P8 的数据：鲜到家（社区生鲜连锁）运营分析组的三份 CSV。
 * 用固定种子的伪随机数生成，每次完全一样；生成一次后缓存。
 *
 * 和真实导出的数据一样“脏”，而且脏数据都不在前 20 行——只看 head() 是发现不了的：
 * - sales.csv：地区写法不一致（华东 / east / East / 华东区……）；约 15% 的销售额来自旧收银系统，
 *   带千分位逗号（"12,345.60"）；少量销售额缺失；约 2.5% 的行被重复导入。
 * - events.csv：平台大小写不一致（iOS / ios / IOS，Android / android）；客户端重试导致同一个 event_id 重复上报；
 *   部分 view 事件的停留时长缺失（非 view 事件本来就没有停留时长）。
 * - nps.csv：评分有 'N/A' 和空值；城市写法不一致（上海 / 上海市 / Shanghai）；评论里有逗号和引号；少量重复提交。
 */

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
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** CSV 字段：含逗号、引号、换行时加引号 */
const field = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const line = (vs: string[]) => vs.map(field).join(',')
const commas = (x: number) => {
  const [i, d] = x.toFixed(2).split('.')
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`
}

/** 在前 `clean` 行之后随机插入重复行 */
function withDuplicates(rows: string[], rng: () => number, rate: number, clean = 20): string[] {
  const out = [...rows]
  const n = Math.round(rows.length * rate)
  for (let k = 0; k < n; k++) {
    const src = clean + Math.floor(rng() * (rows.length - clean))
    const at = Math.min(out.length, clean + 1 + Math.floor(rng() * (out.length - clean)))
    out.splice(at, 0, rows[src])
  }
  return out
}

export const REGIONS = ['华东', '华南', '华北', '西南'] as const
export const CATEGORIES = ['蔬果', '肉禽', '日百'] as const

function sales(rng: () => number): string {
  const regionW: Record<string, number> = { 华东: 1.07, 华南: 1.0, 华北: 0.8, 西南: 0.6 }
  const cat: Record<string, [number, number]> = { 蔬果: [1.0, 38], 肉禽: [0.7, 85], 日百: [0.5, 55] }
  const season: Record<string, number> = { '12': 1.0, '01': 1.15, '02': 0.93, '03': 1.05 }
  const weekday = [1.15, 0.95, 0.92, 0.95, 0.98, 1.08, 1.22] // 周日..周六
  const rows: string[] = []
  const start = dayOf('2025-12-01')
  for (let d = 0; d < 121; d++) {
    const ms = start + d * DAY
    const date = isoDay(ms)
    const f = season[date.slice(5, 7)] * weekday[new Date(ms).getUTCDay()]
    for (const region of REGIONS)
      for (const category of CATEGORIES) {
        const [cw, ticket] = cat[category]
        const orders = Math.round(120 * regionW[region] * cw * f * (0.85 + 0.3 * rng()))
        const revenue = Math.round(orders * ticket * (0.9 + 0.2 * rng()) * 100) / 100
        const refund = rng() < 0.3 ? Math.round(revenue * rng() * 3) / 100 : 0
        const dirty = rows.length >= 20
        let r: string = region
        if (dirty && region === '华东' && rng() < 0.25) r = ['east', 'East', '华东区'][Math.floor(rng() * 3)]
        else if (dirty && region === '华南' && rng() < 0.04) r = ['south', '华南区'][Math.floor(rng() * 2)]
        let rev = revenue.toFixed(2)
        let ref = refund.toFixed(2)
        const roll = rng()
        if (dirty && roll < 0.015) {
          rev = ''
          ref = ''
        } else if (dirty && roll < 0.165) rev = commas(revenue)
        rows.push(line([date, r, category, String(orders), rev, ref]))
      }
  }
  return ['date,region,category,orders,revenue,refund', ...withDuplicates(rows, rng, 0.025)].join('\n')
}

function events(rng: () => number): string {
  const users = Array.from({ length: 150 }, (_, i) => ({
    id: `u${pad(i + 1, 3)}`,
    ios: rng() < 0.45,
    p: 0.05 + rng() * 0.35,
  }))
  const raw: { ts: string; user: string; event: string; ios: boolean; dur: string }[] = []
  const start = dayOf('2026-03-01')
  for (let d = 0; d < 14; d++) {
    const date = isoDay(start + d * DAY)
    for (const u of users) {
      if (rng() > u.p) continue
      const visits = rng() < 0.3 ? 2 : 1
      for (let v = 0; v < visits; v++) {
        let sec = 7 * 3600 + Math.floor(rng() * 15 * 3600)
        const push = (event: string, dur: string) => {
          sec += 5 + Math.floor(rng() * 120)
          const ts = `${date} ${pad(Math.floor(sec / 3600) % 24)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`
          raw.push({ ts, user: u.id, event, ios: u.ios, dur })
        }
        const views = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < views; k++) push('view', String(Math.round(2000 + rng() * rng() * 110_000)))
        if (rng() < 0.35) {
          push('add_cart', '')
          if (rng() < 0.55) {
            push('checkout', '')
            if (rng() < 0.8) push('pay', '')
          }
        }
      }
    }
  }
  raw.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const rows = raw.map((e, i) => {
    const dirty = i >= 20
    let platform = e.ios ? 'iOS' : 'Android'
    if (dirty && e.ios && rng() < 0.2) platform = rng() < 0.5 ? 'ios' : 'IOS'
    else if (dirty && !e.ios && rng() < 0.12) platform = 'android'
    const dur = dirty && e.event === 'view' && rng() < 0.06 ? '' : e.dur
    return line([`e${pad(i + 1, 5)}`, e.user, e.event, platform, e.ts, dur])
  })
  return ['event_id,user_id,event,platform,ts,duration_ms', ...withDuplicates(rows, rng, 0.04)].join('\n')
}

const PROMOTER = ['配送很快，蔬菜也新鲜', '价格实惠，会一直买', '品质稳定，推荐给了邻居', '小程序很好用，下单方便', '早上下单，中午就到了，"准时达"名不虚传', '肉的品质很好，包装干净']
const PASSIVE = ['还行吧，偶尔缺货', '价格一般，活动多的时候再买', '配送时间能再准一点就好了', '品类可以再多一些']
const DETRACTOR = ['配送太慢了，等了两个多小时', '水果不新鲜，有一盒是烂的', '客服态度差，退款拖了一周', '配送员把东西放错了楼，"送达"了但我没收到', '价格比楼下菜场贵，不划算', '配送费涨了，不想用了', '经常缺货，下单后又被取消']

function nps(rng: () => number): string {
  const cities: [string, number][] = [
    ['上海', 30],
    ['北京', 22],
    ['杭州', 18],
    ['深圳', 16],
    ['成都', 14],
  ]
  const scoreW = [3, 2, 2, 3, 4, 7, 8, 12, 15, 17, 27] // 0..10
  const pickW = <T>(xs: [T, number][]) => {
    let r = rng() * xs.reduce((n, [, w]) => n + w, 0)
    for (const [x, w] of xs) if ((r -= w) < 0) return x
    return xs[xs.length - 1][0]
  }
  const rows: string[] = []
  for (let i = 0; i < 420; i++) {
    const dirty = i >= 20
    const score = pickW(scoreW.map((w, s) => [s, w] as [number, number]))
    const pool = score >= 9 ? PROMOTER : score >= 7 ? PASSIVE : DETRACTOR
    let city = pickW(cities)
    if (dirty && city === '上海' && rng() < 0.25) city = ['上海市', 'Shanghai', 'shanghai'][Math.floor(rng() * 3)]
    else if (dirty && city === '北京' && rng() < 0.12) city = '北京市'
    const roll = rng()
    const s = dirty && roll < 0.04 ? 'N/A' : dirty && roll < 0.07 ? '' : String(score)
    const date = `2026-03-${pad(1 + Math.floor(rng() * 14))} ${pad(8 + Math.floor(rng() * 14))}:${pad(Math.floor(rng() * 60))}`
    rows.push(line([`r${pad(i + 1, 4)}`, city, s, rng() < 0.6 ? 'App' : '小程序', pool[Math.floor(rng() * pool.length)], date]))
  }
  return ['resp_id,city,score,channel,comment,submitted_at', ...withDuplicates(rows, rng, 0.02)].join('\n')
}

export interface DatasetInfo {
  name: string
  description: string
}

export const DATASET_INFO: DatasetInfo[] = [
  { name: 'sales', description: '门店日销售：2025-12-01 至 2026-03-31，每天 × 地区 × 品类一行（orders 订单数，revenue 销售额（元），refund 退款金额（元））' },
  { name: 'events', description: 'App 埋点：2026-03-01 至 2026-03-14 的用户行为事件（view 浏览 / add_cart 加购 / checkout 下单 / pay 支付），duration_ms 是浏览停留时长（毫秒）' },
  { name: 'nps', description: 'NPS 满意度调研：2026 年 3 月上旬，每行一份问卷（score 0–10 分，comment 是用户的文字评价）' },
]

let cache: Record<string, string> | undefined

/** 三份 CSV 的原始文本（生成一次后缓存） */
export function datasets(): Record<string, string> {
  if (!cache) {
    const rng = mulberry32(20260401)
    cache = { sales: sales(rng), events: events(rng), nps: nps(rng) }
  }
  return cache
}
