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

// ———————————————— Time zones: leave them to code, not the model ————————————————

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Local date, weekday, minute of day and UTC offset of an instant in a time zone (Intl handles daylight saving correctly) */
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

/** "10/22 Thu 16:30–17:00 (UTC+8)" */
function describe(start: number, end: number, tz: string): string {
  const a = localOf(start, tz)
  return `${a.date.slice(5).replace('-', '/')} ${WEEKDAYS[a.weekday]} ${hhmm(a.min)}–${hhmm(localOf(end, tz).min)} (${zone(a.offset)})`
}

/** Accept only zoned ISO times: the calendar API treats a time without a zone as UTC — 8 hours off */
function parseZoned(s: unknown, field: string): number {
  const v = String(s ?? '').trim()
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(v) || Number.isNaN(Date.parse(v)))
    throw new Error(`${field} must be ISO 8601 with a time zone (e.g. 2026-10-22T08:30:00Z), got "${v}". Use the UTC times returned by find_meeting_slots / list_events as-is`)
  return Date.parse(v)
}

function inWorkingHours(p: Person, s: number, e: number): boolean {
  const a = localOf(s, p.timezone)
  const b = localOf(e - 1, p.timezone)
  return a.date === b.date && a.weekday >= 1 && a.weekday <= 5 && a.min >= toMin(p.workingHours.start) && b.min + 1 <= toMin(p.workingHours.end)
}

// ———————————————— Tools ————————————————

const str = (description: string) => ({ type: 'string', description })
const ISO = 'ISO 8601 in UTC (ending in Z), e.g. 2026-10-22T08:30:00Z'

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
    [`${me.name} local time`]: describe(Date.parse(e.start), Date.parse(e.end), me.timezone),
    organizer: e.organizer,
    attendees: e.attendees.map((a) => people.find((p) => p.email === a)?.name ?? a),
    room: e.room,
  })

  return [
    {
      spec: {
        name: 'find_people',
        description: "Look people up in the company directory by name / email / office. Returns email, office, time zone and local working hours. Use it to get attendees' emails before scheduling.",
        input_schema: { type: 'object', properties: { query: str('Name or keyword, e.g. "Oliver" or "Wang Lei"; omit to list everyone') } },
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
        description: `Find common free slots for a set of attendees (plus an optional room): converts everyone's working hours by their own time zone (including daylight saving) and avoids all existing meetings of the people and the room. Always use it to find times — never convert time zones yourself. Time parameters: ${ISO}.`,
        input_schema: {
          type: 'object',
          properties: {
            attendees: { type: 'array', items: { type: 'string' }, description: "Emails of all attendees (including the requester, if they attend)" },
            duration_minutes: { type: 'number', description: 'Meeting length in minutes' },
            range_start: str(`Start of the search range, ${ISO}`),
            range_end: str(`End of the search range, ${ISO}`),
            room: str('Optional: room id (as returned by list_rooms)'),
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
        const people = emails.map((a) => all.find((p) => p.email === a) ?? (() => { throw new Error(`Unknown attendee ${a}; look up the email with find_people first`) })())
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
          if ((perDay.get(day) ?? 0) >= 3) continue // at most 3 per day, so the options cover more days
          perDay.set(day, (perDay.get(day) ?? 0) + 1)
          slots.push({ start: utc(s), end: utc(e), local: Object.fromEntries(people.map((p) => [p.name, describe(s, e, p.timezone)])) })
        }
        if (!slots.length)
          return {
            slots,
            note: 'No slot in this range where everyone is within working hours and free. Local working hours: ' + people.map((p) => `${p.name} (${p.timezone}) ${p.workingHours.start}–${p.workingHours.end}`).join('; '),
          }
        return { slots }
      },
    },
    {
      spec: {
        name: 'list_rooms',
        description: 'List meeting rooms (id, name, office, capacity, equipment), optionally filtered by office, minimum capacity and equipment.',
        input_schema: {
          type: 'object',
          properties: { office: str('Office: Beijing / London / San Francisco'), min_capacity: { type: 'number', description: 'Minimum number of seats' }, equipment: str('Required equipment, e.g. projector, video conferencing') },
        },
      },
      run: async ({ office, min_capacity, equipment }) =>
        (await env.listRooms(office ? String(office) : undefined)).filter((r) => (!min_capacity || r.capacity >= Number(min_capacity)) && (!equipment || r.equipment.includes(String(equipment)))),
    },
    {
      spec: {
        name: 'list_events',
        description: `List meetings on the requester's calendar (organized or attended), with meeting id, UTC times and ${me.name}'s local time. Use it to find the meeting id before rescheduling / cancelling.`,
        input_schema: {
          type: 'object',
          properties: { range_start: str(`Start, ${ISO}`), range_end: str(`End, ${ISO}`), query: str('Optional: title keyword') },
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
        description: `Create a meeting organized by the requester. Call only after the requester confirms. start / end: ${ISO} — use the values returned by find_meeting_slots as-is.`,
        input_schema: {
          type: 'object',
          properties: {
            title: str('Meeting title'),
            start: str(`Start time, ${ISO}`),
            end: str(`End time, ${ISO}`),
            attendees: { type: 'array', items: { type: 'string' }, description: 'Emails of all attendees (include the requester if they attend)' },
            room: str('Optional: room id'),
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
        description: `Modify an existing meeting (reschedule, change length, add/remove attendees, change room). Always use it to reschedule — never create a new meeting. Call only after the requester confirms. Times: ${ISO}.`,
        input_schema: {
          type: 'object',
          properties: {
            event_id: str('Meeting id (as returned by list_events)'),
            start: str(`New start time, ${ISO}`),
            end: str(`New end time, ${ISO}`),
            attendees: { type: 'array', items: { type: 'string' }, description: 'The new full list of attendee emails' },
            room: str('New room id'),
            title: str('New title'),
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
        description: 'Cancel a meeting. Call only after the requester confirms. Notify attendees by default (pass notify_attendees: false only if the requester explicitly says not to).',
        input_schema: {
          type: 'object',
          properties: { event_id: str('Meeting id'), notify_attendees: { type: 'boolean', description: 'Whether to notify attendees' }, message: str('Note for the attendees') },
          required: ['event_id', 'notify_attendees'],
        },
      },
      run: ({ event_id, notify_attendees, message }) => env.cancelEvent(String(event_id), { notifyAttendees: notify_attendees !== false, message: message ? String(message) : undefined }),
    },
  ]
}

// ———————————————— Prompt: today's date, who the requester is, company policy ————————————————

function systemPrompt(env: CalendarEnv): string {
  const me = env.requester
  const now = Date.parse(env.now())
  const today = localOf(now, me.timezone)
  // A date table for the next few weeks: models often get "next Monday" / "this Friday" wrong, so let it look them up
  const days = Array.from({ length: 21 }, (_, i) => {
    const l = localOf(now + i * 86_400_000, me.timezone)
    return `${l.date} (${WEEKDAYS[l.weekday]})`
  }).join(', ')
  return `You are the meeting assistant at Prism Games, scheduling meetings for ${me.name} (${me.email}, ${me.office} office, time zone ${me.timezone}).

It is now ${today.date} ${WEEKDAYS[today.weekday]} ${hhmm(today.min)} (${me.name}'s local time, ${zone(today.offset)}), i.e. ${env.now()}.
Dates: ${days}.

<company_policy>
${env.rules}
</company_policy>

How to work:
- Get attendees' emails with find_people first; when the requester attends, include ${me.email} in attendees.
- Always find times with find_meeting_slots (it already accounts for everyone's time zone and working hours, including daylight saving). Never convert time zones yourself.
- Pass times to tools exactly as the UTC ISO strings (ending in Z) that tools return. When talking to the requester, use their local time, adding other attendees' local times when useful.
- Respect the requester's preferences and constraints (morning / afternoon, times they don't take meetings, a specific time).
- Once you have a plan, list the title, time, duration, attendees and room for the requester, end with "Shall I book it? Please confirm.", then stop and wait for the reply; call write tools only in the next turn, after they explicitly confirm.
- If the requested time has a conflict, or the request is unclear (no duration or date), give 2–3 concrete options or ask, and let the requester decide.
- If no time satisfies every condition, explain why (e.g. the offices' working hours don't overlap) and offer alternatives; don't book anything.
- Keep replies short, in English.`
}

const MAX_TURNS = 12
const FALLBACK = 'Sorry, I need to double-check something on my side. Is there anything else I can help with?'

export async function assist(env: CalendarEnv): Promise<void> {
  const system = systemPrompt(env)
  const tools = createTools(env)
  // Keep the full history (tool calls and results included) across turns, so the model remembers what was asked and what it proposed
  let messages: Message[] = [{ role: 'user', content: env.user.opening }]
  for (let turn = 1; turn <= MAX_TURNS && !env.user.done; turn++) {
    const res = await runAgent(messages, tools, { system, maxSteps: 10 })
    messages = res.messages
    let reply = res.output.trim()
    if (res.stopReason === 'max_steps' || !reply) {
      log(`Turn ${turn} produced no reply (${res.stopReason}); using the fallback`)
      reply = FALLBACK
      if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: reply })
    }
    const answer = await env.user.respond(reply)
    if (env.user.done) break
    messages.push({ role: 'user', content: answer })
  }
}
