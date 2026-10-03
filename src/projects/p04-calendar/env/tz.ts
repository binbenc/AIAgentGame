/** 时区工具（基于 Intl，正确处理夏令时）。环境和判定器共用。 */

const fmts = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    fmts.set(tz, f)
  }
  return f
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface LocalTime {
  /** YYYY-MM-DD */
  date: string
  /** 0 = 周日 */
  weekday: number
  /** 当天第几分钟 */
  min: number
  /** 相对 UTC 的偏移（分钟） */
  offset: number
}

export function localOf(ms: number, tz: string): LocalTime {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const y = Number(p.year)
  const mo = Number(p.month)
  const d = Number(p.day)
  const h = Number(p.hour) % 24
  const mi = Number(p.minute)
  const offset = Math.round((Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60_000) * 60_000) / 60_000)
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday], min: h * 60 + mi, offset }
}

/** 某时区的当地日期 + 时间 → UTC 毫秒 */
export function zonedToUtc(date: string, hhmm: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  let guess = naive - localOf(naive, tz).offset * 60_000
  guess = naive - localOf(guess, tz).offset * 60_000
  return guess
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
export const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
export const offsetLabel = (offset: number) => `UTC${offset >= 0 ? '+' : '-'}${Math.abs(offset) / 60}${Math.abs(offset) % 60 ? `:${pad(Math.abs(offset) % 60)}` : ''}`
export const isoZ = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

/** “10/26 周一 17:00（UTC+8）” */
export function describeLocal(ms: number, tz: string, endMs?: number): string {
  const l = localOf(ms, tz)
  const end = endMs === undefined ? '' : `–${hhmm(localOf(endMs, tz).min)}`
  return `${l.date.slice(5).replace('-', '/')} ${WEEKDAY_ZH[l.weekday]} ${hhmm(l.min)}${end}（${offsetLabel(l.offset)}）`
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/** 解析 ISO 时间；不带时区的按 UTC 解释（和很多日历 API 一样——这正是“差 8 小时”事故的来源） */
export function parseTime(s: unknown): number {
  if (typeof s !== 'string' || !s.trim()) throw new Error(`时间必须是 ISO 8601 字符串，收到的是 ${JSON.stringify(s)}`)
  const t = s.trim().replace(' ', 'T')
  const ms = Date.parse(HAS_ZONE.test(t) ? t : `${t}Z`)
  if (Number.isNaN(ms)) throw new Error(`无法解析时间“${s}”，请使用 ISO 8601，例如 2026-10-22T08:30:00Z`)
  return ms
}

export const hasZone = (s: string) => HAS_ZONE.test(s.trim())
