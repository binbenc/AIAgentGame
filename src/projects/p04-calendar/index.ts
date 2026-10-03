import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createCalendarEnv, type CalendarEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, userSpecOf, type CalTaskSpec } from './tasks'

const DIR = 'projects/calendar/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<CalendarEnv, void> = {
  id: 'p04',
  number: 4,
  tier: 2,
  title: '会议日程助手',
  tagline: '北京、伦敦、旧金山——时区交给代码，决定交给人',
  client: '棱镜游戏（三地分布式游戏工作室）',
  prototype: { name: 'AppWorld / 日历调度 Agent', url: 'https://appworld.dev/' },
  concepts: ['时区与夏令时', '工具里的时间表示', '多轮澄清', '写操作确认', '基于状态的评测'],
  brief,
  guide,
  entry: `${DIR}agent.ts`,
  contract: `export async function assist(env: CalendarEnv): Promise<void>

interface CalendarEnv {
  user: { opening; respond(text); done }   // 提需求的同事（模拟用户）
  requester: Person; rules: string; now(): string
  listPeople(query?); listRooms(office?); listEvents(rangeStart, rangeEnd, query?)
  getAvailability(emails, rangeStart, rangeEnd)   // 时间：ISO 8601，不带时区的按 UTC 解释
  createEvent({ title, start, end, attendees, room? }); updateEvent(id, patch); cancelEvent(id, { notifyAttendees, message })
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => createCalendarEnv(userSpecOf(task.input as CalTaskSpec), ctx),
  invoke: (mod, _task, env) => mod.assist(env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 125_000,
  maxCallsPerTask: 60,
}
