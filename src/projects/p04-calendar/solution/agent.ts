import { log, type Message } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

export interface SimUser {
  readonly opening: string
  respond(agentMessage: string): Promise<string>
  readonly done: boolean
}

export interface Person {
  name: string
  email: string
  title: string
  office: string
  timezone: string
  workingHours: { start: string; end: string }
  workingDays: string
}

export interface Room {
  id: string
  name: string
  office: string
  capacity: number
  equipment: string[]
}

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  organizer: string
  attendees: string[]
  room: string | null
  status: 'confirmed' | 'cancelled'
}

export interface CalendarEnv {
  user: SimUser
  requester: Person
  rules: string
  now(): string
  listPeople(query?: string): Promise<Person[]>
  listRooms(office?: string): Promise<Room[]>
  getAvailability(emails: string[], rangeStart: string, rangeEnd: string): Promise<{ email: string; busy: { start: string; end: string }[] }[]>
  listEvents(rangeStart: string, rangeEnd: string, query?: string): Promise<CalEvent[]>
  createEvent(input: { title: string; start: string; end: string; attendees: string[]; room?: string }): Promise<CalEvent>
  updateEvent(id: string, patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string | null }): Promise<CalEvent>
  cancelEvent(id: string, opts?: { notifyAttendees?: boolean; message?: string }): Promise<{ id: string; status: 'cancelled'; notified: string[] }>
}

// ———————————————— 时区：交给代码，不交给模型 ————————————————

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** 某个时刻在某时区的当地日期、星期、分钟数、UTC 偏移（Intl 会正确处理夏令时） */
function localOf(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  const h = Number(p.hour) % 24
  const offset = Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute)) - Math.floor(ms / 60_000) * 60_000) / 60_000)
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday], min: h * 60 + Number(p.minute), offset }
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
const utc = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
const zone = (offset: number) => `UTC${offset >= 0 ? '+' : '-'}${Math.abs(offset) / 60}`

/** “10/22 周四 16:30–17:00（UTC+8）” */
function describe(start: number, end: number, tz: string): string {
  const a = localOf(start, tz)
  return `${a.date.slice(5).replace('-', '/')} ${WEEKDAYS[a.weekday]} ${hhmm(a.min)}–${hhmm(localOf(end, tz).min)}（${zone(a.offset)}）`
}

/** 只接受带时区的 ISO 时间：不带时区的时间到了日历 API 会被当成 UTC，差 8 小时 */
function parseZoned(s: unknown, field: string): number {
  const v = String(s ?? '').trim()
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(v) || Number.isNaN(Date.parse(v)))
    throw new Error(`${field} 必须是带时区的 ISO 8601（例如 2026-10-22T08:30:00Z），收到的是“${v}”。请直接使用 find_meeting_slots / list_events 返回的 UTC 时间`)
  return Date.parse(v)
}

function inWorkingHours(p: Person, s: number, e: number): boolean {
  const a = localOf(s, p.timezone)
  const b = localOf(e - 1, p.timezone)
  return a.date === b.date && a.weekday >= 1 && a.weekday <= 5 && a.min >= toMin(p.workingHours.start) && b.min + 1 <= toMin(p.workingHours.end)
}

// ———————————————— 工具 ————————————————

const str = (description: string) => ({ type: 'string', description })
const ISO = '带时区的 ISO 8601，统一用 UTC（以 Z 结尾），例如 2026-10-22T08:30:00Z'

function createTools(env: CalendarEnv): Tool[] {
  const me = env.requester
  const peopleCache: Person[] = []
  const directory = async () => {
    if (!peopleCache.length) peopleCache.push(...(await env.listPeople()))
    return peopleCache
  }
  const view = (e: CalEvent, people: Person[]) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    [`${me.name}的当地时间`]: describe(Date.parse(e.start), Date.parse(e.end), me.timezone),
    organizer: e.organizer,
    attendees: e.attendees.map((a) => people.find((p) => p.email === a)?.name ?? a),
    room: e.room,
  })

  return [
    {
      spec: {
        name: 'find_people',
        description: '在公司人员目录里按姓名 / 邮箱 / 办公室查人，返回邮箱、办公室、时区、当地工作时间。安排会议前用它拿到参会人的邮箱。',
        input_schema: { type: 'object', properties: { query: str('姓名或关键词，例如 "Oliver"、"王磊"；不填返回全部') } },
      },
      run: async ({ query }) => {
        const all = await directory()
        const q = String(query ?? '').trim().toLowerCase()
        return all.filter((p) => !q || `${p.name} ${p.email} ${p.office}`.toLowerCase().includes(q))
      },
    },
    {
      spec: {
        name: 'find_meeting_slots',
        description: `计算一组参会人（可选再加一个会议室）的共同空闲时段：自动按每个人的时区换算工作时间（含夏令时）、避开所有人和会议室已有的会议。找时间一律用它，不要自己换算时区。时间参数用${ISO}。`,
        input_schema: {
          type: 'object',
          properties: {
            attendees: { type: 'array', items: { type: 'string' }, description: '所有参会人的邮箱（包括请求人自己，如果他参加）' },
            duration_minutes: { type: 'number', description: '会议时长（分钟）' },
            range_start: str(`搜索范围开始，${ISO}`),
            range_end: str(`搜索范围结束，${ISO}`),
            room: str('可选：会议室 id（list_rooms 返回的 id）'),
          },
          required: ['attendees', 'duration_minutes', 'range_start', 'range_end'],
        },
      },
      run: async ({ attendees, duration_minutes, range_start, range_end, room }) => {
        const from = parseZoned(range_start, 'range_start')
        const to = parseZoned(range_end, 'range_end')
        const minutes = Number(duration_minutes) || 30
        const all = await directory()
        const emails: string[] = (Array.isArray(attendees) ? attendees : [attendees]).map((a: unknown) => String(a).trim().toLowerCase())
        const people = emails.map((a) => all.find((p) => p.email === a) ?? (() => { throw new Error(`找不到参会人 ${a}，先用 find_people 查邮箱`) })())
        const ids = room ? [...emails, String(room)] : emails
        const busy = (await env.getAvailability(ids, utc(from), utc(to))).flatMap((x) => x.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const))
        const now = Date.parse(env.now())
        const step = 30 * 60_000
        const slots: { start: string; end: string; local: Record<string, string> }[] = []
        const perDay = new Map<string, number>()
        for (let s = Math.ceil(Math.max(from, now) / step) * step; s + minutes * 60_000 <= to && slots.length < 10; s += step) {
          const e = s + minutes * 60_000
          if (!people.every((p) => inWorkingHours(p, s, e))) continue
          if (busy.some(([bs, be]) => bs < e && s < be)) continue
          const day = localOf(s, me.timezone).date
          if ((perDay.get(day) ?? 0) >= 3) continue // 每天最多给 3 个，让选项覆盖更多天
          perDay.set(day, (perDay.get(day) ?? 0) + 1)
          slots.push({ start: utc(s), end: utc(e), local: Object.fromEntries(people.map((p) => [p.name, describe(s, e, p.timezone)])) })
        }
        if (!slots.length)
          return {
            slots,
            note: '这个范围内没有所有人都在工作时间内且都有空的时段。各人的当地工作时间：' + people.map((p) => `${p.name}（${p.timezone}）${p.workingHours.start}–${p.workingHours.end}`).join('；'),
          }
        return { slots }
      },
    },
    {
      spec: {
        name: 'list_rooms',
        description: '列出会议室（id、名称、办公室、容量、设备），可以按办公室、最少容量、设备过滤。',
        input_schema: {
          type: 'object',
          properties: { office: str('办公室：北京 / 伦敦 / 旧金山'), min_capacity: { type: 'number', description: '最少容纳人数' }, equipment: str('需要的设备，例如 投影仪、视频会议') },
        },
      },
      run: async ({ office, min_capacity, equipment }) =>
        (await env.listRooms(office ? String(office) : undefined)).filter((r) => (!min_capacity || r.capacity >= Number(min_capacity)) && (!equipment || r.equipment.includes(String(equipment)))),
    },
    {
      spec: {
        name: 'list_events',
        description: `查询请求人日历上的会议（他组织的或参加的），返回会议 id、UTC 时间和${me.name}的当地时间。改期 / 取消之前用它找到会议 id。`,
        input_schema: {
          type: 'object',
          properties: { range_start: str(`开始，${ISO}`), range_end: str(`结束，${ISO}`), query: str('可选：标题关键词') },
          required: ['range_start', 'range_end'],
        },
      },
      run: async ({ range_start, range_end, query }) => {
        const all = await directory()
        const events = await env.listEvents(utc(parseZoned(range_start, 'range_start')), utc(parseZoned(range_end, 'range_end')), query ? String(query) : undefined)
        return events.map((e) => view(e, all))
      },
    },
    {
      spec: {
        name: 'create_event',
        description: `以请求人为组织者新建会议。只能在请求人确认之后调用。start / end 用${ISO}，直接用 find_meeting_slots 返回的值。`,
        input_schema: {
          type: 'object',
          properties: {
            title: str('会议标题'),
            start: str(`开始时间，${ISO}`),
            end: str(`结束时间，${ISO}`),
            attendees: { type: 'array', items: { type: 'string' }, description: '所有参会人的邮箱（请求人参加的话也要包含）' },
            room: str('可选：会议室 id'),
          },
          required: ['title', 'start', 'end', 'attendees'],
        },
      },
      run: async ({ title, start, end, attendees, room }) => {
        const s = parseZoned(start, 'start')
        const e = parseZoned(end, 'end')
        const ev = await env.createEvent({ title: String(title), start: utc(s), end: utc(e), attendees: Array.isArray(attendees) ? attendees.map(String) : [String(attendees)], room: room ? String(room) : undefined })
        return view(ev, await directory())
      },
    },
    {
      spec: {
        name: 'update_event',
        description: `修改已有会议（改期、改时长、加减参会人、换会议室）。改期一定用它，不要新建会议。只能在请求人确认之后调用。时间用${ISO}。`,
        input_schema: {
          type: 'object',
          properties: {
            event_id: str('会议 id（list_events 返回的 id）'),
            start: str(`新的开始时间，${ISO}`),
            end: str(`新的结束时间，${ISO}`),
            attendees: { type: 'array', items: { type: 'string' }, description: '新的完整参会人邮箱列表' },
            room: str('新的会议室 id'),
            title: str('新的标题'),
          },
          required: ['event_id'],
        },
      },
      run: async ({ event_id, start, end, attendees, room, title }) => {
        const patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string } = {}
        if (start !== undefined) patch.start = utc(parseZoned(start, 'start'))
        if (end !== undefined) patch.end = utc(parseZoned(end, 'end'))
        if (attendees !== undefined) patch.attendees = (Array.isArray(attendees) ? attendees : [attendees]).map(String)
        if (room !== undefined) patch.room = String(room)
        if (title !== undefined) patch.title = String(title)
        return view(await env.updateEvent(String(event_id), patch), await directory())
      },
    },
    {
      spec: {
        name: 'cancel_event',
        description: '取消会议。只能在请求人确认之后调用。默认通知参会人（请求人明确说不用通知时 notify_attendees 传 false）。',
        input_schema: {
          type: 'object',
          properties: { event_id: str('会议 id'), notify_attendees: { type: 'boolean', description: '是否通知参会人' }, message: str('给参会人的说明') },
          required: ['event_id', 'notify_attendees'],
        },
      },
      run: ({ event_id, notify_attendees, message }) => env.cancelEvent(String(event_id), { notifyAttendees: notify_attendees !== false, message: message ? String(message) : undefined }),
    },
  ]
}

// ———————————————— 提示词：今天是哪天、请求人是谁、公司规范 ————————————————

function systemPrompt(env: CalendarEnv): string {
  const me = env.requester
  const now = Date.parse(env.now())
  const today = localOf(now, me.timezone)
  // 未来两周的日期表：模型算“下周一”“这周五”经常算错，直接给它查
  const days = Array.from({ length: 21 }, (_, i) => {
    const l = localOf(now + i * 86_400_000, me.timezone)
    return `${l.date}（${WEEKDAYS[l.weekday]}）`
  }).join('、')
  return `你是棱镜游戏的会议日程助手，替 ${me.name}（${me.email}，${me.office}办公室，时区 ${me.timezone}）安排会议。

现在是 ${today.date} ${WEEKDAYS[today.weekday]} ${hhmm(today.min)}（${me.name}的当地时间，${zone(today.offset)}），即 ${env.now()}。
日期参考：${days}。

<公司规范>
${env.rules}
</公司规范>

工作方式：
- 先用 find_people 拿到参会人的邮箱；请求人自己参加时，attendees 里也要有 ${me.email}。
- 找时间一律用 find_meeting_slots（它已经按每个人的时区和工作时间算好了，含夏令时），不要自己换算时区。
- 传给工具的时间一律用工具返回的 UTC ISO 时间（以 Z 结尾），原样传入。和请求人沟通时，用他的当地时间，必要时附上其他参会人的当地时间。
- 请求人提到的偏好和限制（上午 / 下午、某些时间不开会、指定的时间）必须遵守。
- 方案确定后，先把标题、时间、时长、参会人、会议室列给请求人，以“确认的话我就预订，可以吗？”结尾，然后停下来等他回复；他明确确认后，下一轮再调用写操作。
- 指定时间有冲突、或者需求不清楚（时长、日期没说）时，给出 2~3 个具体选项或提问，让请求人决定。
- 找不到满足所有条件的时间时，说明原因（例如各地工作时间没有交集），给出替代方案，不要预订。
- 回复简洁，用中文。`
}

const MAX_TURNS = 12
const FALLBACK = '抱歉，我这边需要再确认一下，请问还有什么需要帮忙的吗？'

export async function assist(env: CalendarEnv): Promise<void> {
  const system = systemPrompt(env)
  const tools = createTools(env)
  // 完整的对话历史（含工具调用和结果）跨轮保留：模型才记得请求人要什么、自己提议过什么
  let messages: Message[] = [{ role: 'user', content: env.user.opening }]
  for (let turn = 1; turn <= MAX_TURNS && !env.user.done; turn++) {
    const res = await runAgent(messages, tools, { system, maxSteps: 10 })
    messages = res.messages
    let reply = res.output.trim()
    if (res.stopReason === 'max_steps' || !reply) {
      log(`第 ${turn} 轮没有产出回复（${res.stopReason}），使用兜底话术`)
      reply = FALLBACK
      if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: reply })
    }
    const answer = await env.user.respond(reply)
    if (env.user.done) break
    messages.push({ role: 'user', content: answer })
  }
}
