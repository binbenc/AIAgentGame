/**
 * 棱镜游戏（Prism Games）：北京 / 伦敦 / 旧金山三地的游戏工作室。
 * 场景里的“现在”是 2026-10-21（周三）北京时间 10:00。
 * 时区陷阱：伦敦 10 月 25 日结束夏令时（BST → GMT），旧金山 11 月 1 日结束夏令时（PDT → PST）。
 * 所有会议时间都以 UTC 存储。
 */

export interface Person {
  name: string
  email: string
  title: string
  office: '北京' | '伦敦' | '旧金山'
  /** IANA 时区名 */
  timezone: string
  /** 当地时间的工作时间 */
  workingHours: { start: string; end: string }
  workingDays: string
}

export interface Room {
  id: string
  name: string
  office: '北京' | '伦敦' | '旧金山'
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

const D = '@prismgames.com'
const p = (name: string, user: string, title: string, office: Person['office'], start: string, end: string): Person => ({
  name,
  email: user + D,
  title,
  office,
  timezone: office === '北京' ? 'Asia/Shanghai' : office === '伦敦' ? 'Europe/London' : 'America/Los_Angeles',
  workingHours: { start, end },
  workingDays: '周一至周五',
})

export const PEOPLE: Person[] = [
  p('陈雨', 'chen.yu', '制作人', '北京', '09:00', '18:00'),
  p('王磊', 'wang.lei', '主程序', '北京', '10:00', '19:00'),
  p('刘倩', 'liu.qian', '美术总监', '北京', '09:00', '18:00'),
  p('张浩', 'zhang.hao', '系统策划', '北京', '09:30', '18:30'),
  p('Oliver Smith', 'oliver.smith', '发行经理', '伦敦', '09:00', '17:30'),
  p('Emma Brown', 'emma.brown', '市场经理', '伦敦', '08:00', '16:00'),
  p('Sarah Lee', 'sarah.lee', '社区负责人', '旧金山', '10:00', '19:00'),
  p('Mike Johnson', 'mike.johnson', '技术美术', '旧金山', '09:00', '17:00'),
]

export const email = (name: string) => PEOPLE.find((x) => x.name.startsWith(name))!.email
export const REQUESTER = PEOPLE[0]

const r = (id: string, name: string, office: Room['office'], capacity: number, equipment: string[]): Room => ({ id: `room-${id}${D}`, name, office, capacity, equipment })

export const ROOMS: Room[] = [
  r('changcheng', '长城', '北京', 4, ['电视']),
  r('gugong', '故宫', '北京', 10, ['投影仪', '白板']),
  r('tiantan', '天坛', '北京', 8, ['电视', '白板']),
  r('yiheyuan', '颐和园', '北京', 12, ['投影仪', '视频会议']),
  r('thames', 'Thames', '伦敦', 6, ['视频会议', '电视']),
  r('soho', 'Soho', '伦敦', 10, ['投影仪']),
  r('golden-gate', 'Golden Gate', '旧金山', 8, ['视频会议', '投影仪']),
]
export const room = (name: string) => ROOMS.find((x) => x.name === name)!.id

const e = (id: string, title: string, start: string, end: string, organizer: string, attendees: string[], roomId: string | null = null): CalEvent => ({
  id,
  title,
  start,
  end,
  organizer: email(organizer),
  attendees: attendees.map(email),
  room: roomId,
  status: 'confirmed',
})

const TEAM = ['陈雨', '王磊', '刘倩', '张浩']

export const EVENTS: CalEvent[] = [
  e('evt-100', '项目周会', '2026-10-19T01:00:00Z', '2026-10-19T02:00:00Z', '陈雨', TEAM),
  e('evt-101', '项目周会', '2026-10-26T01:00:00Z', '2026-10-26T02:00:00Z', '陈雨', TEAM),
  e('evt-102', '项目周会', '2026-11-02T01:00:00Z', '2026-11-02T02:00:00Z', '陈雨', TEAM),
  e('evt-201', '1:1 陈雨 / Emma', '2026-10-22T08:00:00Z', '2026-10-22T08:30:00Z', '陈雨', ['陈雨', 'Emma']),
  e('evt-202', '版本评审', '2026-10-23T01:00:00Z', '2026-10-23T04:00:00Z', '陈雨', ['陈雨']),
  e('evt-203', '设计评审', '2026-10-29T06:00:00Z', '2026-10-29T07:00:00Z', '陈雨', ['陈雨', '刘倩', '张浩'], room('故宫')),
  e('evt-301', '代码评审', '2026-10-22T02:00:00Z', '2026-10-22T02:30:00Z', '王磊', ['王磊']),
  e('evt-302', '引擎升级讨论', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00Z', '王磊', ['王磊', '陈雨']),
  e('evt-401', '美术外包对接', '2026-10-22T05:00:00Z', '2026-10-22T06:00:00Z', '刘倩', ['刘倩']),
  e('evt-402', '外包验收', '2026-10-27T01:00:00Z', '2026-10-27T02:00:00Z', '刘倩', ['刘倩']),
  e('evt-601', '发行例会', '2026-10-21T08:00:00Z', '2026-10-21T10:00:00Z', 'Oliver', ['Oliver']),
  e('evt-701', '社区周会', '2026-10-22T17:00:00Z', '2026-10-22T18:00:00Z', 'Sarah', ['Sarah']),
  e('evt-801', '外部访客：渠道沟通', '2026-10-22T04:00:00Z', '2026-10-22T07:30:00Z', '刘倩', [], room('故宫')),
]

export const ASSISTANT_RULES = `# 棱镜游戏 · 会议预订规范

- 会议只能安排在**每位参会人**的工作时间内（按各自所在时区的当地时间，周一至周五）。
- 不能和任何参会人（以及会议室）已有的会议冲突。
- 预订、改期、取消会议之前，要把详情（标题、时间、时长、参会人、会议室）告诉请求人，**得到明确确认后**再执行。
- 请求人指定的时间有冲突，或者有多个合理选项时，列出选项让请求人选，不要替他决定。
- 找不到满足所有条件的时间时，说明原因并给出最接近的替代方案，不要擅自预订。
- 改期要修改原会议，不要新建一个；取消会议时默认通知参会人（请求人明确说不用通知的除外）。
- 只有会议的组织者可以修改或取消会议。
`
