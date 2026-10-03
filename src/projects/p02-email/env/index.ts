/**
 * P2 的环境：一封待处理的邮件 + 收件箱（往来邮件）+ CRM + 日历 + 会留下记录的写操作。
 * 环境提供的是“原始 API”，怎么包装成给模型用的工具、要不要给模型，由玩家决定。
 * 写操作（label / createDraft / forward / scheduleMeeting）都会记录下来，判定器据此检查结果。
 */
import { L } from '../../../engine/locale'
import type { EnvCtx } from '../../types'
import { CONTACTS, EVENTS, LABELS, ME, NOW, RULES, WORK_END, WORK_START, type CalEvent, type Contact, type Email, type Label, type Profile } from './data'

export interface MailEnv {
  /** 邮箱主人（客户经理） */
  me: Profile
  /** 邮件处理规则（Markdown） */
  rules: string
  /** 场景里的“现在”（ISO 8601，北京时间） */
  now(): string
  inbox: {
    /** 某个会话里的全部邮件（按时间排序，包含当前这封） */
    thread(threadId: string): Promise<Email[]>
    /** 按关键词搜索收件箱（主题、正文、发件人） */
    search(query: string): Promise<Email[]>
  }
  crm: {
    /** 按邮箱查联系人；查不到返回 null */
    findContact(email: string): Promise<Contact | null>
    /** 按姓名 / 公司关键词搜索联系人 */
    search(query: string): Promise<Contact[]>
  }
  calendar: {
    /** 某一天（YYYY-MM-DD，北京时间）我的全部日程 */
    listEvents(date: string): Promise<CalEvent[]>
    /** 某一天我在工作时间（9:00–18:00）内的空闲时间段（每段至少 minutes 分钟，默认 30） */
    freeSlots(date: string, minutes?: number): Promise<{ start: string; end: string }[]>
  }
  /** 给邮件打标签（ignore / notify / respond） */
  label(emailId: string, label: Label): Promise<void>
  /** 为邮件创建一封回复草稿（不会发送） */
  createDraft(emailId: string, body: string): Promise<{ draftId: string }>
  /** 把邮件转发给某人 */
  forward(emailId: string, to: string, note?: string): Promise<void>
  /** 在我的日历上建会并邀请参会人。start / end 必须是带时区的 ISO 8601 */
  scheduleMeeting(meeting: { title: string; start: string; end: string; attendees: string[] }): Promise<CalEvent>
}

export interface MailState {
  email: Email
  inbox: Email[]
  events: CalEvent[]
  labels: { emailId: string; label: string }[]
  drafts: { emailId: string; body: string }[]
  forwards: { emailId: string; to: string; note?: string }[]
  meetings: CalEvent[]
}

const STATES = new WeakMap<MailEnv, MailState>()
export const stateOf = (env: MailEnv): MailState => STATES.get(env)!

const fail = (msg: string): never => {
  throw new Error(msg)
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i
const DAY_MS = 86_400_000
const BJ_MS = 8 * 3_600_000

/** ISO 时间 → 北京时间的日期和当天分钟数 */
export function bj(iso: string): { date: string; min: number } {
  const t = Date.parse(iso) + BJ_MS
  const d = new Date(t)
  return { date: d.toISOString().slice(0, 10), min: Math.floor((t % DAY_MS) / 60_000) }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
const iso = (date: string, min: number) => `${date}T${hhmm(min)}:00+08:00`

/** 某天的忙碌区间（北京时间分钟） */
export function busyOf(events: CalEvent[], date: string): [number, number][] {
  return events
    .filter((e) => bj(e.start).date === date)
    .map((e) => [bj(e.start).min, bj(e.end).min] as [number, number])
    .sort((a, b) => a[0] - b[0])
}

export function freeOf(events: CalEvent[], date: string, minutes = 30): [number, number][] {
  const out: [number, number][] = []
  let cur = WORK_START
  for (const [s, e] of busyOf(events, date)) {
    if (s - cur >= minutes) out.push([cur, Math.min(s, WORK_END)])
    cur = Math.max(cur, e)
  }
  if (WORK_END - cur >= minutes) out.push([cur, WORK_END])
  return out.filter(([s, e]) => e - s >= minutes)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const badDate = (date: unknown) => L(`date 的格式应为 YYYY-MM-DD（北京时间），收到的是“${date}”`, `date must be YYYY-MM-DD (Beijing time), got "${date}"`)

export function createMailEnv(email: Email, thread: Email[], ctx: EnvCtx): MailEnv {
  const inbox = [...thread.filter((m) => m.id !== email.id), email].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const state: MailState = { email, inbox, events: structuredClone(EVENTS), labels: [], drafts: [], forwards: [], meetings: [] }
  const known = (id: unknown) => (typeof id === 'string' && inbox.some((m) => m.id === id) ? id : fail(L(`邮件 ${String(id)} 不存在（当前邮件的 id 是 ${email.id}）`, `Email ${String(id)} does not exist (the current email's id is ${email.id})`)))
  const api = <A extends unknown[], R>(name: string, ms: number, fn: (...a: A) => R) =>
    ctx.traced(name, async (...a: A) => {
      await ctx.delay(ms)
      return fn(...a)
    })

  const env: MailEnv = {
    me: ME,
    rules: RULES,
    now: () => NOW,
    inbox: {
      thread: api('inbox.thread', 40, (threadId: string) => structuredClone(inbox.filter((m) => m.threadId === threadId))),
      search: api('inbox.search', 60, (query: string) => {
        const q = String(query ?? '').trim()
        return structuredClone(inbox.filter((m) => q && `${m.subject}\n${m.body}\n${m.from}\n${m.fromName}`.includes(q)))
      }),
    },
    crm: {
      findContact: api('crm.findContact', 50, (addr: string) => {
        const a = String(addr ?? '').trim().toLowerCase()
        return structuredClone(CONTACTS.find((c) => c.email === a) ?? null)
      }),
      search: api('crm.search', 60, (query: string) => {
        const q = String(query ?? '').trim()
        return structuredClone(CONTACTS.filter((c) => q && `${c.name} ${c.company} ${c.email}`.includes(q)))
      }),
    },
    calendar: {
      listEvents: api('calendar.listEvents', 50, (date: string) => {
        if (!DATE_RE.test(String(date))) fail(badDate(date))
        return structuredClone(state.events.filter((e) => bj(e.start).date === date))
      }),
      freeSlots: api('calendar.freeSlots', 50, (date: string, minutes?: number) => {
        if (!DATE_RE.test(String(date))) fail(badDate(date))
        const m = Number(minutes) > 0 ? Number(minutes) : 30
        return freeOf(state.events, date, m).map(([s, e]) => ({ start: iso(date, s), end: iso(date, e) }))
      }),
    },
    label: api('label', 30, (emailId: string, label: Label) => {
      known(emailId)
      if (!LABELS.includes(label)) fail(L(`标签只能是 ${LABELS.join(' / ')}，收到的是“${label}”`, `label must be one of ${LABELS.join(' / ')}, got "${label}"`))
      state.labels.push({ emailId, label })
    }),
    createDraft: api('createDraft', 60, (emailId: string, body: string) => {
      known(emailId)
      if (typeof body !== 'string' || !body.trim()) fail(L('草稿正文不能为空', 'Draft body must not be empty'))
      state.drafts.push({ emailId, body })
      return { draftId: `draft-${state.drafts.length}` }
    }),
    forward: api('forward', 60, (emailId: string, to: string, note?: string) => {
      known(emailId)
      if (typeof to !== 'string' || !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(to.trim())) fail(L(`收件人邮箱格式不对：“${to}”`, `Invalid recipient email address: "${to}"`))
      state.forwards.push({ emailId, to: to.trim().toLowerCase(), note })
    }),
    scheduleMeeting: api('scheduleMeeting', 80, (m: { title: string; start: string; end: string; attendees: string[] }) => {
      const { title, start, end, attendees } = m ?? ({} as typeof m)
      if (typeof start !== 'string' || typeof end !== 'string' || !HAS_ZONE.test(start) || !HAS_ZONE.test(end))
        fail(
          L(
            `start / end 必须是带时区的 ISO 8601（例如 2026-10-15T16:30:00+08:00），收到的是 ${JSON.stringify({ start, end })}`,
            `start / end must be ISO 8601 with a time zone (e.g. 2026-10-15T16:30:00+08:00), got ${JSON.stringify({ start, end })}`,
          ),
        )
      if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) fail(L('start / end 无效，或者结束时间不晚于开始时间', 'Invalid start / end, or end is not after start'))
      if (!Array.isArray(attendees) || !attendees.length) fail(L('attendees 必须是非空的邮箱数组', 'attendees must be a non-empty array of email addresses'))
      const event: CalEvent = { id: `e-new-${state.meetings.length + 1}`, title: String(title ?? L('会议', 'Meeting')), start, end, attendees: [ME.email, ...attendees.map((a) => String(a).trim().toLowerCase())] }
      state.meetings.push(event)
      state.events.push(event)
      return structuredClone(event)
    }),
  }
  STATES.set(env, state)
  return env
}
