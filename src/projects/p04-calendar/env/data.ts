/**
 * 棱镜游戏（Prism Games）：北京 / 伦敦 / 旧金山三地的游戏工作室。
 * 场景里的“现在”是 2026-10-21（周三）北京时间 10:00。
 * 时区陷阱：伦敦 10 月 25 日结束夏令时（BST → GMT），旧金山 11 月 1 日结束夏令时（PDT → PST）。
 * 所有会议时间都以 UTC 存储。
 * 英文版：人名、职位、办公室、会议室、设备、会议标题、规范翻译成英文；邮箱、id、时间不变。
 */
import { L } from '../../../engine/locale'

export interface Person {
  name: string
  email: string
  title: string
  office: string
  /** IANA 时区名 */
  timezone: string
  /** 当地时间的工作时间 */
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
  /** UTC，ISO 8601（以 Z 结尾） */
  start: string
  end: string
  organizer: string
  attendees: string[]
  room: string | null
  status: 'confirmed' | 'cancelled'
}

export const NOW = '2026-10-21T02:00:00Z'

/** 办公室名称（当前语言） */
export const OFFICES = L({ bj: '北京', ldn: '伦敦', sf: '旧金山' }, { bj: 'Beijing', ldn: 'London', sf: 'San Francisco' })
type OfficeKey = keyof typeof OFFICES
const TZ: Record<OfficeKey, string> = { bj: 'Asia/Shanghai', ldn: 'Europe/London', sf: 'America/Los_Angeles' }
/** 会议室设备（当前语言） */
export const EQUIP = L(
  { tv: '电视', projector: '投影仪', whiteboard: '白板', video: '视频会议' },
  { tv: 'TV', projector: 'projector', whiteboard: 'whiteboard', video: 'video conferencing' },
)
type EquipKey = keyof typeof EQUIP

const D = '@prismgames.com'
/** 中文名（任务数据里用它引用人和会议室，两种语言都认） */
const ZH_NAME = new Map<string, string>()
const p = (zh: string, en: string, user: string, title: [string, string], office: OfficeKey, start: string, end: string): Person => {
  ZH_NAME.set(user + D, zh)
  return {
    name: L(zh, en),
    email: user + D,
    title: L(...title),
    office: OFFICES[office],
    timezone: TZ[office],
    workingHours: { start, end },
    workingDays: L('周一至周五', 'Mon–Fri'),
  }
}

export const PEOPLE: Person[] = [
  p('陈雨', 'Chen Yu', 'chen.yu', ['制作人', 'Producer'], 'bj', '09:00', '18:00'),
  p('王磊', 'Wang Lei', 'wang.lei', ['主程序', 'Lead Programmer'], 'bj', '10:00', '19:00'),
  p('刘倩', 'Liu Qian', 'liu.qian', ['美术总监', 'Art Director'], 'bj', '09:00', '18:00'),
  p('张浩', 'Zhang Hao', 'zhang.hao', ['系统策划', 'Systems Designer'], 'bj', '09:30', '18:30'),
  p('Oliver Smith', 'Oliver Smith', 'oliver.smith', ['发行经理', 'Publishing Manager'], 'ldn', '09:00', '17:30'),
  p('Emma Brown', 'Emma Brown', 'emma.brown', ['市场经理', 'Marketing Manager'], 'ldn', '08:00', '16:00'),
  p('Sarah Lee', 'Sarah Lee', 'sarah.lee', ['社区负责人', 'Community Lead'], 'sf', '10:00', '19:00'),
  p('Mike Johnson', 'Mike Johnson', 'mike.johnson', ['技术美术', 'Technical Artist'], 'sf', '09:00', '17:00'),
]

/** 按名字（中文名或当前语言的名字，前缀即可）查邮箱 */
export const email = (name: string) => PEOPLE.find((x) => x.name.startsWith(name) || ZH_NAME.get(x.email)!.startsWith(name))!.email
export const REQUESTER = PEOPLE[0]

const r = (id: string, name: [string, string], office: OfficeKey, capacity: number, equipment: EquipKey[]): Room => {
  ZH_NAME.set(`room-${id}${D}`, name[0])
  return { id: `room-${id}${D}`, name: L(...name), office: OFFICES[office], capacity, equipment: equipment.map((k) => EQUIP[k]) }
}

export const ROOMS: Room[] = [
  r('changcheng', ['长城', 'Great Wall'], 'bj', 4, ['tv']),
  r('gugong', ['故宫', 'Forbidden City'], 'bj', 10, ['projector', 'whiteboard']),
  r('tiantan', ['天坛', 'Temple of Heaven'], 'bj', 8, ['tv', 'whiteboard']),
  r('yiheyuan', ['颐和园', 'Summer Palace'], 'bj', 12, ['projector', 'video']),
  r('thames', ['Thames', 'Thames'], 'ldn', 6, ['video', 'tv']),
  r('soho', ['Soho', 'Soho'], 'ldn', 10, ['projector']),
  r('golden-gate', ['Golden Gate', 'Golden Gate'], 'sf', 8, ['video', 'projector']),
]
/** 按名字（中文名或当前语言的名字）查会议室 id */
export const room = (name: string) => ROOMS.find((x) => x.name === name || ZH_NAME.get(x.id) === name)!.id

const e = (id: string, title: [string, string], start: string, end: string, organizer: string, attendees: string[], roomId: string | null = null): CalEvent => ({
  id,
  title: L(...title),
  start,
  end,
  organizer: email(organizer),
  attendees: attendees.map(email),
  room: roomId,
  status: 'confirmed',
})

const TEAM = ['陈雨', '王磊', '刘倩', '张浩']

export const EVENTS: CalEvent[] = [
  e('evt-100', ['项目周会', 'Weekly project sync'], '2026-10-19T01:00:00Z', '2026-10-19T02:00:00Z', '陈雨', TEAM),
  e('evt-101', ['项目周会', 'Weekly project sync'], '2026-10-26T01:00:00Z', '2026-10-26T02:00:00Z', '陈雨', TEAM),
  e('evt-102', ['项目周会', 'Weekly project sync'], '2026-11-02T01:00:00Z', '2026-11-02T02:00:00Z', '陈雨', TEAM),
  e('evt-201', ['1:1 陈雨 / Emma', '1:1 Chen Yu / Emma'], '2026-10-22T08:00:00Z', '2026-10-22T08:30:00Z', '陈雨', ['陈雨', 'Emma']),
  e('evt-202', ['版本评审', 'Release review'], '2026-10-23T01:00:00Z', '2026-10-23T04:00:00Z', '陈雨', ['陈雨']),
  e('evt-203', ['设计评审', 'Design review'], '2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z', '陈雨', ['陈雨', '刘倩', '张浩'], room('故宫')),
  e('evt-301', ['代码评审', 'Code review'], '2026-10-22T02:00:00Z', '2026-10-22T02:30:00Z', '王磊', ['王磊']),
  e('evt-302', ['引擎升级讨论', 'Engine upgrade discussion'], '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z', '王磊', ['王磊', '陈雨']),
  e('evt-401', ['美术外包对接', 'Art outsourcing sync'], '2026-10-22T05:00:00Z', '2026-10-22T06:00:00Z', '刘倩', ['刘倩']),
  e('evt-402', ['外包验收', 'Outsourcing sign-off'], '2026-10-27T01:00:00Z', '2026-10-27T02:00:00Z', '刘倩', ['刘倩']),
  e('evt-601', ['发行例会', 'Publishing weekly'], '2026-10-21T08:00:00Z', '2026-10-21T10:00:00Z', 'Oliver', ['Oliver']),
  e('evt-701', ['社区周会', 'Community weekly'], '2026-10-22T17:00:00Z', '2026-10-22T18:00:00Z', 'Sarah', ['Sarah']),
  e('evt-801', ['外部访客：渠道沟通', 'External visitors: channel partners'], '2026-10-22T04:00:00Z', '2026-10-22T07:30:00Z', '刘倩', [], room('故宫')),
]

const ASSISTANT_RULES_ZH = `# 棱镜游戏 · 会议预订规范

- 会议只能安排在**每位参会人**的工作时间内（按各自所在时区的当地时间，周一至周五）。
- 不能和任何参会人（以及会议室）已有的会议冲突。
- 预订、改期、取消会议之前，要把详情（标题、时间、时长、参会人、会议室）告诉请求人，**得到明确确认后**再执行。
- 请求人指定的时间有冲突，或者有多个合理选项时，列出选项让请求人选，不要替他决定。
- 找不到满足所有条件的时间时，说明原因并给出最接近的替代方案，不要擅自预订。
- 改期要修改原会议，不要新建一个；取消会议时默认通知参会人（请求人明确说不用通知的除外）。
- 只有会议的组织者可以修改或取消会议。
`

const ASSISTANT_RULES_EN = `# Prism Games · Meeting booking policy

- Meetings may only be scheduled within **every attendee's** working hours (local time in their own time zone, Monday to Friday).
- A meeting must not clash with any existing meeting of any attendee (or of the room).
- Before booking, rescheduling or cancelling a meeting, tell the requester the details (title, time, duration, attendees, room) and act **only after they explicitly confirm**.
- If the requested time has a conflict, or there are several reasonable options, list the options and let the requester choose — don't decide for them.
- If no time satisfies every condition, explain why and offer the closest alternatives; don't book anything on your own.
- To reschedule, modify the original meeting instead of creating a new one. When cancelling, notify attendees by default (unless the requester explicitly says not to).
- Only a meeting's organizer can modify or cancel it.
`

export const ASSISTANT_RULES = L(ASSISTANT_RULES_ZH, ASSISTANT_RULES_EN)
