/**
 * P4 的环境：全公司的日历 + 人员目录 + 会议室 + 一位通过自然语言提需求的同事（模拟用户）。
 * 环境 API 和 Google Calendar 类似：时间以 UTC 存储，接受带时区的 ISO 8601；**不带时区的时间按 UTC 解释**。
 * 写操作（createEvent / updateEvent / cancelEvent）会记录到 action log（发生在请求人第几轮发言之后），
 * 判定器据此检查“该问的有没有先问”。
 */
import { L } from '../../../engine/locale'
import { createSimUser, type SimUser, type SimUserSpec } from '../../usersim'
import type { EnvCtx } from '../../types'
import { ASSISTANT_RULES, EVENTS, NOW, PEOPLE, REQUESTER, ROOMS, type CalEvent, type Person, type Room } from './data'
import { isoZ, parseTime } from './tz'

export interface CalendarEnv {
  /** 提需求的同事（模拟用户） */
  user: SimUser
  /** 请求人是谁 */
  requester: Person
  /** 公司的会议预订规范（Markdown） */
  rules: string
  /** 场景里的“现在”（UTC ISO 8601） */
  now(): string
  /** 人员目录：按姓名 / 邮箱 / 办公室过滤，不传返回全部 */
  listPeople(query?: string): Promise<Person[]>
  /** 会议室列表：可按办公室过滤 */
  listRooms(office?: string): Promise<Room[]>
  /** 查询一组人（或会议室 id）在时间范围内的忙碌时段（UTC） */
  getAvailability(emails: string[], rangeStart: string, rangeEnd: string): Promise<{ email: string; busy: { start: string; end: string }[] }[]>
  /** 请求人日历上的会议（他组织的或参加的），可按标题关键词过滤 */
  listEvents(rangeStart: string, rangeEnd: string, query?: string): Promise<CalEvent[]>
  /** 以请求人为组织者创建会议。attendees 要包含所有参会人（包括请求人自己，如果他参加） */
  createEvent(input: { title: string; start: string; end: string; attendees: string[]; room?: string }): Promise<CalEvent>
  /** 修改会议（只有组织者可以修改） */
  updateEvent(id: string, patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string | null }): Promise<CalEvent>
  /** 取消会议（只有组织者可以取消）。notifyAttendees 为 true 时给参会人发通知 */
  cancelEvent(id: string, opts?: { notifyAttendees?: boolean; message?: string }): Promise<{ id: string; status: 'cancelled'; notified: string[] }>
}

export interface ActionRecord {
  op: 'create' | 'update' | 'cancel'
  eventId: string
  args: unknown
  /** 写操作发生时，请求人已经说了几轮话（0 = 只有开场白） */
  turn: number
  /** 当时请求人最近说的一句话 */
  userText: string
  notify?: boolean
  message?: string
}

export interface CalState {
  events: CalEvent[]
  actions: ActionRecord[]
  user: SimUser
}

const STATES = new WeakMap<CalendarEnv, CalState>()
export const stateOf = (env: CalendarEnv): CalState => STATES.get(env)!

const fail = (msg: string): never => {
  throw new Error(msg)
}

const overlaps = (e: CalEvent, s: number, t: number) => Date.parse(e.start) < t && s < Date.parse(e.end)

export function createCalendarEnv(spec: SimUserSpec, ctx: EnvCtx): CalendarEnv {
  const user = createSimUser({ role: L('同事', 'Colleague'), persona: L('一位正在使用公司内部日程助手的同事', "a colleague using the company's internal scheduling assistant"), ...spec }, ctx)
  const state: CalState = { events: structuredClone(EVENTS), actions: [], user }
  const { events } = state
  const me = REQUESTER.email

  const api = <A extends unknown[], R>(name: string, ms: number, fn: (...a: A) => R) =>
    ctx.traced(name, async (...a: A) => {
      await ctx.delay(ms)
      return fn(...a)
    })

  const knownEmail = (x: unknown): string => {
    const a = String(x ?? '').trim().toLowerCase()
    if (PEOPLE.some((p) => p.email === a) || ROOMS.some((r) => r.id === a)) return a
    return fail(L(`找不到“${x}”：参会人要用公司邮箱（先用 listPeople 查），会议室要用 listRooms 返回的 id`, `Unknown "${x}": attendees must be company emails (look them up with listPeople first), rooms must be ids from listRooms`))
  }
  const range = (a: string, b: string) => {
    const s = parseTime(a)
    const t = parseTime(b)
    if (t <= s) fail(L('rangeEnd 必须晚于 rangeStart', 'rangeEnd must be after rangeStart'))
    if (t - s > 62 * 86_400_000) fail(L('时间范围不能超过 62 天', 'The range cannot exceed 62 days'))
    return [s, t] as const
  }
  const turnNow = () => user.transcript.filter((m) => m.role === 'user').length - 1
  const lastUser = () => [...user.transcript].reverse().find((m) => m.role === 'user')?.text ?? ''
  const record = (a: Omit<ActionRecord, 'turn' | 'userText'>) => state.actions.push({ ...a, turn: turnNow(), userText: lastUser() })

  function people(list: unknown): string[] {
    if (!Array.isArray(list) || !list.length) fail(L('attendees 必须是非空的邮箱数组', 'attendees must be a non-empty array of emails'))
    const out = [...new Set((list as unknown[]).map(knownEmail))]
    const rooms = out.filter((x) => ROOMS.some((r) => r.id === x))
    if (rooms.length) fail(L(`会议室 ${rooms.join('、')} 不能放在 attendees 里，请用 room 参数`, `Rooms (${rooms.join(', ')}) don't go in attendees; use the room parameter`))
    return out
  }
  function roomOf(x: unknown): string | null {
    if (x === undefined || x === null || x === '') return null
    const id = String(x).trim().toLowerCase()
    const hit = ROOMS.find((r) => r.id === id || r.name.toLowerCase() === id)
    return hit ? hit.id : fail(L(`会议室“${x}”不存在，请用 listRooms 返回的 id`, `Room "${x}" doesn't exist; use an id from listRooms`))
  }
  function times(start: unknown, end: unknown) {
    const s = parseTime(start)
    const t = parseTime(end)
    if (t <= s) fail(L('结束时间必须晚于开始时间', 'end must be after start'))
    if (t - s > 8 * 3_600_000) fail(L('单个会议不能超过 8 小时', 'A meeting cannot be longer than 8 hours'))
    return { start: isoZ(s), end: isoZ(t) }
  }
  function own(id: unknown): CalEvent {
    const ev = events.find((x) => x.id === String(id ?? '').trim()) ?? fail(L(`会议 ${id} 不存在`, `Meeting ${id} doesn't exist`))
    if (ev.status === 'cancelled') fail(L(`会议 ${ev.id} 已经取消了`, `Meeting ${ev.id} is already cancelled`))
    if (ev.organizer !== me) fail(L(`只有组织者（${ev.organizer}）可以修改或取消会议“${ev.title}”，请让请求人联系组织者`, `Only the organizer (${ev.organizer}) can modify or cancel "${ev.title}"; ask the requester to contact the organizer`))
    return ev
  }

  const env: CalendarEnv = {
    user,
    requester: structuredClone(REQUESTER),
    rules: ASSISTANT_RULES,
    now: () => NOW,
    listPeople: api('listPeople', 40, (query?: string) => {
      const q = String(query ?? '').trim().toLowerCase()
      return structuredClone(PEOPLE.filter((x) => !q || `${x.name} ${x.email} ${x.office} ${x.title}`.toLowerCase().includes(q)))
    }),
    listRooms: api('listRooms', 40, (office?: string) => {
      const o = String(office ?? '').trim()
      return structuredClone(ROOMS.filter((x) => !o || x.office === o))
    }),
    getAvailability: api('getAvailability', 80, (emails: string[], rangeStart: string, rangeEnd: string) => {
      const [s, t] = range(rangeStart, rangeEnd)
      if (!Array.isArray(emails) || !emails.length) fail(L('emails 必须是非空数组', 'emails must be a non-empty array'))
      return emails.map((x) => {
        const id = knownEmail(x)
        const busy = events
          .filter((ev) => ev.status === 'confirmed' && (ev.attendees.includes(id) || ev.room === id) && overlaps(ev, s, t))
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((ev) => ({ start: ev.start, end: ev.end }))
        return { email: id, busy }
      })
    }),
    listEvents: api('listEvents', 60, (rangeStart: string, rangeEnd: string, query?: string) => {
      const [s, t] = range(rangeStart, rangeEnd)
      const q = String(query ?? '').trim()
      return structuredClone(
        events
          .filter((ev) => ev.status === 'confirmed' && (ev.organizer === me || ev.attendees.includes(me)) && overlaps(ev, s, t) && (!q || ev.title.includes(q)))
          .sort((a, b) => a.start.localeCompare(b.start)),
      )
    }),
    createEvent: api('createEvent', 120, (input: { title: string; start: string; end: string; attendees: string[]; room?: string }) => {
      const i = input ?? ({} as typeof input)
      const ev: CalEvent = { id: `evt-new-${state.actions.length + 1}`, title: String(i.title || L('会议', 'Meeting')), ...times(i.start, i.end), organizer: me, attendees: people(i.attendees), room: roomOf(i.room), status: 'confirmed' }
      events.push(ev)
      record({ op: 'create', eventId: ev.id, args: structuredClone(i) })
      return structuredClone(ev)
    }),
    updateEvent: api('updateEvent', 120, (id: string, patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string | null }) => {
      const ev = own(id)
      const pt = patch ?? {}
      const next = { ...ev }
      if (pt.start !== undefined || pt.end !== undefined) Object.assign(next, times(pt.start ?? ev.start, pt.end ?? ev.end))
      if (pt.attendees !== undefined) next.attendees = people(pt.attendees)
      if (pt.room !== undefined) next.room = roomOf(pt.room)
      if (pt.title !== undefined) next.title = String(pt.title)
      Object.assign(ev, next)
      record({ op: 'update', eventId: ev.id, args: structuredClone(pt) })
      return structuredClone(ev)
    }),
    cancelEvent: api('cancelEvent', 100, (id: string, opts?: { notifyAttendees?: boolean; message?: string }) => {
      const ev = own(id)
      ev.status = 'cancelled'
      const notify = !!opts?.notifyAttendees
      record({ op: 'cancel', eventId: ev.id, args: { id, ...opts }, notify, message: opts?.message })
      return { id: ev.id, status: 'cancelled' as const, notified: notify ? ev.attendees.filter((x) => x !== me) : [] }
    }),
  }
  STATES.set(env, state)
  return env
}
