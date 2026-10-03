import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import briefEn from './brief.en.md?raw'
import { createCalendarEnv, type CalendarEnv } from './env/index'
import guide from './guide.md?raw'
import guideEn from './guide.en.md?raw'
import { mock } from './mock'
import { toTasks, userSpecOf, type CalTaskSpec } from './tasks'

const DIR = 'projects/calendar/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<CalendarEnv, void> = {
  id: 'p04',
  number: 4,
  tier: 2,
  title: L('会议日程助手', 'Meeting Scheduler'),
  tagline: L('北京、伦敦、旧金山——时区交给代码，决定交给人', 'Beijing, London, San Francisco — time zones go to code, decisions go to people'),
  client: L('棱镜游戏（三地分布式游戏工作室）', 'Prism Games (a game studio spread across three cities)'),
  prototype: { name: L('AppWorld / 日历调度 Agent', 'AppWorld / calendar scheduling agents'), url: 'https://appworld.dev/' },
  concepts: L(['时区与夏令时', '工具里的时间表示', '多轮澄清', '写操作确认', '基于状态的评测'], ['Time zones & daylight saving', 'Representing time in tools', 'Multi-turn clarification', 'Confirming writes', 'State-based evaluation']),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}agent.ts`,
  contract: `export async function assist(env: CalendarEnv): Promise<void>

interface CalendarEnv {
  user: { opening; respond(text); done }   // ${L('提需求的同事（模拟用户）', 'the colleague making the request (simulated user)')}
  requester: Person; rules: string; now(): string
  listPeople(query?); listRooms(office?); listEvents(rangeStart, rangeEnd, query?)
  getAvailability(emails, rangeStart, rangeEnd)   // ${L('时间：ISO 8601，不带时区的按 UTC 解释', 'times: ISO 8601; no time zone = UTC')}
  createEvent({ title, start, end, attendees, room? }); updateEvent(id, patch); cancelEvent(id, { notifyAttendees, message })
}`,
  starter: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
      rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
    ),
  ),
  solution: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
      rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
    ),
  ),
  createEnv: (task, ctx) => createCalendarEnv(userSpecOf(task.input as CalTaskSpec), ctx),
  invoke: (mod, _task, env) => mod.assist(env),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(125_000, 102_000),
  maxCallsPerTask: 60,
}
