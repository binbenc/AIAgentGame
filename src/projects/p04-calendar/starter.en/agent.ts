import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** The colleague making the request: like a real person, they say only a sentence or two at a time */
export interface SimUser {
  /** Opening line */
  readonly opening: string
  /** Send the assistant's message and get the reply; a reply containing ###STOP### means they ended the conversation */
  respond(agentMessage: string): Promise<string>
  readonly done: boolean
}

export interface Person {
  name: string
  email: string
  title: string
  office: string
  /** IANA time zone, e.g. Europe/London */
  timezone: string
  /** Working hours in local time */
  workingHours: { start: string; end: string }
  workingDays: string
}

export interface Room {
  /** Room id (an email address) */
  id: string
  name: string
  office: string
  capacity: number
  equipment: string[]
}

export interface CalEvent {
  id: string
  title: string
  /** UTC, ISO 8601 */
  start: string
  end: string
  organizer: string
  attendees: string[]
  room: string | null
  status: 'confirmed' | 'cancelled'
}

export interface CalendarEnv {
  /** The colleague making the request (simulated user) */
  user: SimUser
  /** Who the requester is */
  requester: Person
  /** The company's meeting booking policy (Markdown) */
  rules: string
  /** "Now" in the scenario (UTC ISO 8601) */
  now(): string
  listPeople(query?: string): Promise<Person[]>
  listRooms(office?: string): Promise<Room[]>
  /** Busy periods (UTC) of a set of people (or room ids) within a time range */
  getAvailability(emails: string[], rangeStart: string, rangeEnd: string): Promise<{ email: string; busy: { start: string; end: string }[] }[]>
  /** Meetings on the requester's calendar */
  listEvents(rangeStart: string, rangeEnd: string, query?: string): Promise<CalEvent[]>
  /** Times are ISO 8601 with a time zone; times without one are treated as UTC */
  createEvent(input: { title: string; start: string; end: string; attendees: string[]; room?: string }): Promise<CalEvent>
  updateEvent(id: string, patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string | null }): Promise<CalEvent>
  cancelEvent(id: string, opts?: { notifyAttendees?: boolean; message?: string }): Promise<{ id: string; status: 'cancelled'; notified: string[] }>
}

const prop = (description: string) => ({ type: 'string', description })

/**
 * Entry point of the meeting assistant: talk with the requester over multiple turns, starting from env.user.opening, until they're done (env.user.done).
 * This is a project: there's no TODO list and the architecture is yours. Read the brief first, then look at the task list.
 */
export async function assist(env: CalendarEnv): Promise<void> {
  // The most naive version: wrap the environment API as tools as-is, and start a fresh conversation every turn.
  // The model isn't told today's date, who the requester is, or the company policy, and does all time zone math itself — see what it books.
  const tools: Tool[] = [
    { spec: { name: 'list_people', description: 'List company people', input_schema: { type: 'object', properties: { query: prop('Name') } } }, run: ({ query }) => env.listPeople(query) },
    {
      spec: { name: 'get_availability', description: 'Check availability', input_schema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'string' } }, range_start: prop('Start time'), range_end: prop('End time') }, required: ['emails', 'range_start', 'range_end'] } },
      run: ({ emails, range_start, range_end }) => env.getAvailability(emails, range_start, range_end),
    },
    { spec: { name: 'list_rooms', description: 'List meeting rooms', input_schema: { type: 'object', properties: { office: prop('Office') } } }, run: ({ office }) => env.listRooms(office) },
    {
      spec: { name: 'list_events', description: 'List my meetings', input_schema: { type: 'object', properties: { range_start: prop('Start time'), range_end: prop('End time') }, required: ['range_start', 'range_end'] } },
      run: ({ range_start, range_end }) => env.listEvents(range_start, range_end),
    },
    {
      spec: {
        name: 'create_event',
        description: 'Create a meeting',
        input_schema: { type: 'object', properties: { title: prop('Title'), start: prop('Start time'), end: prop('End time'), attendees: { type: 'array', items: { type: 'string' } }, room: prop('Room') }, required: ['title', 'start', 'end', 'attendees'] },
      },
      run: (input) => env.createEvent(input),
    },
    {
      spec: { name: 'update_event', description: 'Update a meeting', input_schema: { type: 'object', properties: { event_id: prop('Meeting id'), start: prop('Start time'), end: prop('End time') }, required: ['event_id'] } },
      run: ({ event_id, ...patch }) => env.updateEvent(event_id, patch),
    },
    { spec: { name: 'cancel_event', description: 'Cancel a meeting', input_schema: { type: 'object', properties: { event_id: prop('Meeting id') }, required: ['event_id'] } }, run: ({ event_id }) => env.cancelEvent(event_id) },
  ]

  let message = env.user.opening
  for (let turn = 0; turn < 10 && !env.user.done; turn++) {
    const res = await runAgent(message, tools)
    message = await env.user.respond(res.output)
  }
}
