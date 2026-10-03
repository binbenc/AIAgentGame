/**
 * 判定器用的“可信分析代码”：按甲方的清洗规则把三份 CSV 洗干净，再提供算标准答案用的小工具。
 * 清洗规则（brief.md 里写给玩家的同一套）：
 * - 重复记录只算一次：sales 是完全相同的行，events 按 event_id，nps 按 resp_id；
 * - 缺失 / 无效值不参与计算（空值、'N/A'、超出 0–10 的评分）；
 * - 地区、平台、城市的不同写法合并成标准写法；数字去掉千分位逗号。
 */
import { datasets } from './env/data'
import { parseCsv } from './env/sandbox'

export interface Sale {
  date: string
  region: string
  category: string
  orders: number
  revenue: number | null
  refund: number | null
}
export interface Event {
  id: string
  user: string
  event: string
  platform: string
  ts: string
  durationMs: number | null
}
export interface Survey {
  id: string
  city: string
  score: number | null
  channel: string
  comment: string
}

export function num(s: string | undefined): number | null {
  const t = String(s ?? '').replace(/,/g, '').trim()
  if (t === '' || /^n\/?a$/i.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const REGION: Record<string, string> = { east: '华东', 华东区: '华东', south: '华南', 华南区: '华南', north: '华北', 华北区: '华北', 西南区: '西南' }
export const region = (s: string) => REGION[s.trim().toLowerCase()] ?? REGION[s.trim()] ?? s.trim()
export const platform = (s: string) => (/^ios$/i.test(s.trim()) ? 'iOS' : /^android$/i.test(s.trim()) ? 'Android' : s.trim())
const CITY: Record<string, string> = { 上海市: '上海', shanghai: '上海', 北京市: '北京', beijing: '北京' }
export const city = (s: string) => CITY[s.trim().toLowerCase()] ?? CITY[s.trim()] ?? s.trim()

function uniqBy<T>(rows: T[], key: (r: T) => string): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = key(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface Clean {
  sales: Sale[]
  /** 去重前的 sales 行数 */
  salesRaw: number
  events: Event[]
  surveys: Survey[]
}

let cache: Clean | undefined

export function clean(): Clean {
  if (cache) return cache
  const d = datasets()
  const rawSales = parseCsv(d.sales)
  const sales = uniqBy(rawSales, (r) => JSON.stringify(r)).map((r) => ({
    date: r.date,
    region: region(r.region),
    category: r.category,
    orders: num(r.orders) ?? 0,
    revenue: num(r.revenue),
    refund: num(r.refund),
  }))
  const events = uniqBy(parseCsv(d.events), (r) => r.event_id).map((r) => ({
    id: r.event_id,
    user: r.user_id,
    event: r.event,
    platform: platform(r.platform),
    ts: r.ts,
    durationMs: num(r.duration_ms),
  }))
  const surveys = uniqBy(parseCsv(d.nps), (r) => r.resp_id).map((r) => {
    const s = num(r.score)
    return { id: r.resp_id, city: city(r.city), score: s !== null && Number.isInteger(s) && s >= 0 && s <= 10 ? s : null, channel: r.channel, comment: r.comment }
  })
  cache = { sales, salesRaw: rawSales.length, events, surveys }
  return cache
}

// —— 统计小工具 ——

export const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const mean = (xs: number[]) => sum(xs) / xs.length

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 线性插值分位数（与 numpy.percentile 的默认方法一致） */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const pos = (p / 100) * (s.length - 1)
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo)
}

export function std(xs: number[]): number {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs)
  const my = mean(ys)
  let a = 0
  let b = 0
  let c = 0
  for (let i = 0; i < xs.length; i++) {
    a += (xs[i] - mx) * (ys[i] - my)
    b += (xs[i] - mx) ** 2
    c += (ys[i] - my) ** 2
  }
  return a / Math.sqrt(b * c)
}

/** 按 key 分组求和 */
export function sumBy<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r))
  return m
}

/** 有销售额的行（缺失的不计入） */
export const withRevenue = (rows: Sale[]) => rows.filter((r) => r.revenue !== null) as (Sale & { revenue: number })[]

export function nps(scores: number[]): number {
  const pro = scores.filter((s) => s >= 9).length
  const det = scores.filter((s) => s <= 6).length
  return ((pro - det) / scores.length) * 100
}
