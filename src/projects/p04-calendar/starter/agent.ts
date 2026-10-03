import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** 提需求的同事：和真人一样，一次只说一两句话 */
export interface SimUser {
  /** 开场白 */
  readonly opening: string
  /** 把助手的话发给对方，拿到回复；回复里包含 ###STOP### 表示对方结束了对话 */
  respond(agentMessage: string): Promise<string>
  readonly done: boolean
}

export interface Person {
  name: string
  email: string
  title: string
  office: string
  /** IANA 时区名，例如 Europe/London */
  timezone: string
  /** 当地时间的工作时间 */
  workingHours: { start: string; end: string }
  workingDays: string
}

export interface Room {
  /** 会议室 id（邮箱形式） */
  id: string
  name: string
  office: string
  capacity: number
  equipment: string[]
}

export interface CalEvent {
  id: string
  title: string
  /** UTC，ISO 8601 */
  start: string
  end: string
  organizer: string
  attendees: string[]
  room: string | null
  status: 'confirmed' | 'cancelled'
}

export interface CalendarEnv {
  /** 提需求的同事（模拟用户） */
  user: SimUser
  /** 请求人是谁 */
  requester: Person
  /** 公司的会议预订规范（Markdown） */
  rules: string
  /** 场景里的“现在”（UTC ISO 8601） */
  now(): string
  listPeople(query?: string): Promise<Person[]>
  listRooms(office?: string): Promise<Room[]>
  /** 一组人（或会议室 id）在时间范围内的忙碌时段（UTC） */
  getAvailability(emails: string[], rangeStart: string, rangeEnd: string): Promise<{ email: string; busy: { start: string; end: string }[] }[]>
  /** 请求人日历上的会议 */
  listEvents(rangeStart: string, rangeEnd: string, query?: string): Promise<CalEvent[]>
  /** 时间接受带时区的 ISO 8601；不带时区的按 UTC 解释 */
  createEvent(input: { title: string; start: string; end: string; attendees: string[]; room?: string }): Promise<CalEvent>
  updateEvent(id: string, patch: { title?: string; start?: string; end?: string; attendees?: string[]; room?: string | null }): Promise<CalEvent>
  cancelEvent(id: string, opts?: { notifyAttendees?: boolean; message?: string }): Promise<{ id: string; status: 'cancelled'; notified: string[] }>
}

const prop = (description: string) => ({ type: 'string', description })

/**
 * 会议日程助手的入口：从 env.user.opening 开始和请求人多轮对话，直到对方结束（env.user.done）。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function assist(env: CalendarEnv): Promise<void> {
  // 最朴素的版本：把环境 API 原样包成工具，每一轮都是全新的对话；
  // 没告诉模型今天是哪天、请求人是谁、公司有什么规范，时区全靠模型自己算——试试看会订出什么。
  const tools: Tool[] = [
    { spec: { name: 'list_people', description: '列出公司人员', input_schema: { type: 'object', properties: { query: prop('姓名') } } }, run: ({ query }) => env.listPeople(query) },
    {
      spec: { name: 'get_availability', description: '查询忙闲', input_schema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'string' } }, range_start: prop('开始时间'), range_end: prop('结束时间') }, required: ['emails', 'range_start', 'range_end'] } },
      run: ({ emails, range_start, range_end }) => env.getAvailability(emails, range_start, range_end),
    },
    { spec: { name: 'list_rooms', description: '列出会议室', input_schema: { type: 'object', properties: { office: prop('办公室') } } }, run: ({ office }) => env.listRooms(office) },
    {
      spec: { name: 'list_events', description: '查询我的会议', input_schema: { type: 'object', properties: { range_start: prop('开始时间'), range_end: prop('结束时间') }, required: ['range_start', 'range_end'] } },
      run: ({ range_start, range_end }) => env.listEvents(range_start, range_end),
    },
    {
      spec: {
        name: 'create_event',
        description: '创建会议',
        input_schema: { type: 'object', properties: { title: prop('标题'), start: prop('开始时间'), end: prop('结束时间'), attendees: { type: 'array', items: { type: 'string' } }, room: prop('会议室') }, required: ['title', 'start', 'end', 'attendees'] },
      },
      run: (input) => env.createEvent(input),
    },
    {
      spec: { name: 'update_event', description: '修改会议', input_schema: { type: 'object', properties: { event_id: prop('会议 id'), start: prop('开始时间'), end: prop('结束时间') }, required: ['event_id'] } },
      run: ({ event_id, ...patch }) => env.updateEvent(event_id, patch),
    },
    { spec: { name: 'cancel_event', description: '取消会议', input_schema: { type: 'object', properties: { event_id: prop('会议 id') }, required: ['event_id'] } }, run: ({ event_id }) => env.cancelEvent(event_id) },
  ]

  let message = env.user.opening
  for (let turn = 0; turn < 10 && !env.user.done; turn++) {
    const res = await runAgent(message, tools)
    message = await env.user.respond(res.output)
  }
}
