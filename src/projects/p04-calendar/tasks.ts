/**
 * P4 任务集：每个任务 = 一位提需求的同事（模拟用户）+ 期望的日历最终状态。
 * 判定只看结果（与模型无关）：
 *   1. 最终日历：该建的会建了（参会人、时长、时间窗口、会议室都对），该改的改了（原会议被移动而不是复制一份），该取消的取消了；
 *      不该动的会议一个都没动；
 *   2. 约束：每个会议都在**每位参会人当地的工作时间**内（按 IANA 时区换算，含夏令时），不和任何参会人 / 会议室的其它会议冲突；
 *   3. 流程：需要请求人做选择 / 确认的任务，写操作必须发生在请求人明确选择或确认之后（来自 action log）。
 */
import { STOP, type SimUserSpec } from '../usersim'
import type { CheckResult, ProjectTask } from '../types'
import { EVENTS, PEOPLE, REQUESTER, ROOMS, email, type CalEvent } from './env/data'
import { stateOf, type CalendarEnv } from './env/index'
import { describeLocal, localOf, toMin } from './env/tz'

export interface CreateExpect {
  /** 参会人（不含会议室），必须完全一致 */
  attendees: string[]
  minutes: number
  /** 会议必须完整落在其中一个窗口里（UTC） */
  windows: [string, string][]
  /** 窗口的中文说明（失败提示用） */
  when: string
  room?: { office: string; minCapacity: number; equipment?: string }
}

export interface CalExpect {
  /** 要新建的会议；空数组 = 不应该新建任何会议 */
  creates: CreateExpect[]
  update?: { id: string; start: string; end: string; attendees?: string[] }
  cancel?: { id: string; notify?: boolean }
  /** 写操作必须在请求人明确选择 / 确认之后 */
  mustAsk?: boolean
  /** 助手说的话里必须出现（解释原因） */
  mustSay?: { re: RegExp; what: string }
}

export interface ScriptSpec {
  /** 助手请求确认时怎么回 */
  confirm?: string
  /** 助手报告冲突 / 给出选项时怎么选（只选一次） */
  choose?: string
  /** 助手问到特定问题时怎么答 */
  answers?: [RegExp, string][]
  /** 助手说做不到时怎么回（会结束对话） */
  onImpossible?: string
}

export interface CalTaskSpec {
  id: string
  title: string
  core: boolean
  opening: string
  /** 真实模式下模拟用户的人设 */
  instruction: string
  script?: ScriptSpec
  expect: CalExpect
  why: string
}

const ME = '你是棱镜游戏的制作人陈雨（chen.yu@prismgames.com），在北京办公室工作，正在用公司的会议日程助手安排会议。'
const CONFIRM = '助手列出会议详情请你确认时，核对无误就回复“可以，就这么订”。办完后道谢并结束对话。'

/** 北京时间某天（或某天的某段）对应的 UTC 窗口 */
const bjDay = (date: string, from = '00:00', to = '24:00'): [string, string] => {
  const base = Date.parse(`${date}T00:00:00+08:00`)
  return [new Date(base + toMin(from) * 60_000).toISOString(), new Date(base + toMin(to) * 60_000).toISOString()]
}
const exact = (start: string, minutes: number): [string, string] => [start, new Date(Date.parse(start) + minutes * 60_000).toISOString()]
const who = (...names: string[]) => names.map(email)

export const TASK_SPECS: CalTaskSpec[] = [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  {
    id: 'three-zones',
    title: '跨三地约 30 分钟',
    core: true,
    opening: '帮我约一下王磊和 Oliver，明天找 30 分钟聊聊海外版本的发布计划，我也参加。',
    instruction: `${ME}你想明天（10 月 22 日，周四）和王磊（北京）、Oliver（伦敦）开一个 30 分钟的会，聊海外版本的发布计划，你自己也参加。时间不限，只要大家都在工作时间、都有空就行。${CONFIRM}`,
    script: {},
    expect: { creates: [{ attendees: who('陈雨', '王磊', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-22')], when: '明天（10 月 22 日，北京时间）' }] },
    why: '三个人的工作时间（北京 / 伦敦）要换算到同一个时区再找交集，还要避开各自已有的会议',
  },
  {
    id: 'reschedule',
    title: '改期：移动原会议',
    core: true,
    opening: '明天下午我和 Emma 的 1:1 挪到周五同一时间吧。',
    instruction: `${ME}你明天（10 月 22 日）下午 4 点（北京时间）和 Emma 有一个 1:1，想挪到本周五（10 月 23 日）同一时间。${CONFIRM}`,
    script: {},
    expect: { creates: [], update: { id: 'evt-201', start: '2026-10-23T08:00:00Z', end: '2026-10-23T08:30:00Z' } },
    why: '改期要修改原来的会议（updateEvent），而不是新建一个——否则日历上会出现两个 1:1',
  },
  {
    id: 'room-projector',
    title: '订有投影仪的会议室',
    core: true,
    opening: '明天下午和刘倩、张浩开 1 小时的美术评审，我也参加，在北京办公室订个至少能坐 8 个人、有投影仪的会议室。',
    instruction: `${ME}你想明天（10 月 22 日）下午（北京时间）和刘倩、张浩开 1 小时的美术评审会，你也参加。需要北京办公室的会议室：至少 8 人、有投影仪。${CONFIRM}`,
    script: {},
    expect: {
      creates: [{ attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-22', '12:00', '18:00')], when: '明天（10 月 22 日）下午（北京时间）', room: { office: '北京', minCapacity: 8, equipment: '投影仪' } }],
    },
    why: '会议室要满足容量、设备、所在办公室，并且在那个时间段没有被占用',
  },
  {
    id: 'no-friday-pm',
    title: '遵守“周五下午不开会”',
    core: true,
    opening: '这周五或者下周一，帮我和刘倩、张浩约 1 小时同步一下进度。对了，我周五下午不开会。',
    instruction: `${ME}你想在本周五（10 月 23 日）或下周一（10 月 26 日）和刘倩、张浩开 1 小时的进度同步会，你也参加。你有个习惯：周五下午（北京时间 12 点以后）不开会。${CONFIRM}`,
    script: {},
    expect: {
      creates: [{ attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-23', '00:00', '12:00'), bjDay('2026-10-26')], when: '周五上午或下周一（北京时间；请求人周五下午不开会）' }],
    },
    why: '请求人说了“周五下午不开会”，最早的空闲时间恰好在周五下午，不能选',
  },
  {
    id: 'conflict-choose',
    title: '指定时间有冲突：让请求人选',
    core: true,
    opening: '明天上午 10 点（北京时间）和王磊开 30 分钟会，聊下引擎升级。',
    instruction: `${ME}你想明天（10 月 22 日）上午 10 点（北京时间）和王磊开 30 分钟的会，你也参加。如果助手说 10 点有冲突、给你几个选项，你就选 11:00。${CONFIRM}`,
    script: { choose: '那就 11:00 吧。' },
    expect: { creates: [{ attendees: who('陈雨', '王磊'), minutes: 30, windows: [exact('2026-10-22T03:00:00.000Z', 30)], when: '明天北京时间 11:00（请求人在冲突后选择的时间）' }], mustAsk: true },
    why: '王磊 10:00 已有安排：要告诉请求人并给出选项，由请求人决定（他会选 11:00），不能自作主张订 10:30',
  },
  {
    id: 'cancel-notify',
    title: '取消会议并通知参会人',
    core: true,
    opening: '下周一的项目周会取消吧，跟大家说一声，改期另行通知。',
    instruction: `${ME}你想取消下周一（10 月 26 日）的项目周会（只取消这一次，11 月 2 日那次保留），并通知参会人“改期另行通知”。${CONFIRM}`,
    script: {},
    expect: { creates: [], cancel: { id: 'evt-101', notify: true }, mustAsk: true },
    why: '要取消的是 10 月 26 日那一次项目周会（不是上周、也不是 11 月 2 日的），取消前要确认，取消时要通知参会人',
  },
  {
    id: 'dst-next-week',
    title: '夏令时陷阱：下周的伦敦',
    core: true,
    opening: '下周一（10 月 26 日）下午帮我和 Oliver 约 30 分钟。',
    instruction: `${ME}你想在下周一（10 月 26 日）下午（北京时间）和 Oliver（伦敦）开 30 分钟的会，你也参加。${CONFIRM}`,
    script: {},
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-26', '12:00', '18:00')], when: '10 月 26 日下午（北京时间）' }] },
    why: '伦敦 10 月 25 日结束夏令时（UTC+1 → UTC+0）。按“今天”的时差去算下周，会把会议订在 Oliver 上班之前',
  },
  {
    id: 'impossible',
    title: '找不到共同时间：解释并给替代方案',
    core: true,
    opening: '明天和 Sarah、Oliver 一起开 1 小时的会，我也参加。',
    instruction: `${ME}你想明天和 Sarah（旧金山）、Oliver（伦敦）三个人一起开 1 小时的会。如果助手说找不到大家都在工作时间的时段、给出替代方案，你就说“好的，那我先分别跟他们约，这次先不订了”，然后结束对话。不要接受任何在别人工作时间以外的安排。`,
    script: { onImpossible: '好的，那我先分别跟他们约，这次先不订了。' },
    expect: { creates: [], mustSay: { re: /工作时间|时区|重叠|交集|共同|上班/, what: '解释为什么找不到时间（三地的工作时间没有交集）' } },
    why: '北京、伦敦、旧金山三地的工作时间没有共同的 1 小时：应该说明原因、给出替代方案（例如分开开），不能擅自订一个有人不在工作时间的会',
  },

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  {
    id: 'two-sessions',
    title: '一次订两场培训',
    core: false,
    opening: '下周二和下周四上午，各订一场 1 小时的新人培训，刘倩、张浩参加，我也参加。',
    instruction: `${ME}你想在下周二（10 月 27 日）上午和下周四（10 月 29 日）上午（北京时间）各订一场 1 小时的新人培训，参会人：你、刘倩、张浩。不需要会议室。${CONFIRM}`,
    expect: {
      creates: [
        { attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-27', '00:00', '12:00')], when: '10 月 27 日上午（北京时间）' },
        { attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-29', '00:00', '12:00')], when: '10 月 29 日上午（北京时间）' },
      ],
    },
    why: '两场会各自要满足约束，不能重复预订',
  },
  {
    id: 'date-boundary',
    title: '跨日期线：北京周五 = 旧金山周四',
    core: false,
    opening: '帮张浩和 Sarah 约个 30 分钟的会，北京时间周五，我不参加。',
    instruction: `${ME}你想帮张浩（北京）和 Sarah（旧金山）约一个 30 分钟的会，时间在北京时间本周五（10 月 23 日），你自己不参加。${CONFIRM}`,
    expect: { creates: [{ attendees: who('张浩', 'Sarah'), minutes: 30, windows: [bjDay('2026-10-23')], when: '北京时间 10 月 23 日（周五）' }] },
    why: '北京周五早上是旧金山周四晚上：只有北京 9:30–10:00 这半小时同时落在两人的工作时间里',
  },
  {
    id: 'room-video',
    title: '视频会议室 + 三人跨时区',
    core: false,
    opening: '下周三和 Oliver、Emma 开 1 小时视频会，我也参加，在北京订一个有视频会议设备的会议室。',
    instruction: `${ME}你想在下周三（10 月 28 日）和 Oliver、Emma（都在伦敦）开 1 小时的视频会，你也参加，需要北京办公室有视频会议设备的会议室。${CONFIRM}`,
    expect: {
      creates: [{ attendees: who('陈雨', 'Oliver', 'Emma'), minutes: 60, windows: [bjDay('2026-10-28')], when: '10 月 28 日（北京时间）', room: { office: '北京', minCapacity: 1, equipment: '视频会议' } }],
    },
    why: '伦敦已切换到冬令时：三人的共同工作时间只剩北京 17:00–18:00 这一小时',
  },
  {
    id: 'reschedule-conflict',
    title: '改期目标时间有冲突',
    core: false,
    opening: '下周一的项目周会改到下周二同一时间。',
    instruction: `${ME}你想把下周一（10 月 26 日）上午 9 点的项目周会改到下周二（10 月 27 日）同一时间。如果助手说有人冲突，你就说“那改到周二上午 11 点（北京时间）”。${CONFIRM}`,
    expect: { creates: [], update: { id: 'evt-101', start: '2026-10-27T03:00:00Z', end: '2026-10-27T04:00:00Z' }, mustAsk: true },
    why: '周二 9 点刘倩有安排：要告诉请求人，按他的选择改到周二 11 点，并且是修改原会议',
  },
  {
    id: 'cancel-not-organizer',
    title: '不能取消别人组织的会',
    core: false,
    opening: '把下周二王磊那个引擎升级讨论取消掉吧，我去不了。',
    instruction: `${ME}你想取消下周二（10 月 27 日）的“引擎升级讨论”，但这个会是王磊组织的。如果助手说只有组织者能取消，你就说“那我自己跟王磊说吧”，结束对话。`,
    expect: { creates: [] },
    why: '这个会议的组织者是王磊，只有组织者能取消；应该向请求人说明，而不是想别的办法改动它',
  },
  {
    id: 'add-attendee',
    title: '给已有会议加人',
    core: false,
    opening: '下周四的设计评审把王磊也加上。',
    instruction: `${ME}你想把下周四（10 月 29 日）下午的设计评审加上王磊，时间不变。${CONFIRM}`,
    expect: { creates: [], update: { id: 'evt-203', start: '2026-10-29T06:00:00Z', end: '2026-10-29T07:00:00Z', attendees: who('陈雨', '刘倩', '张浩', '王磊') } },
    why: '修改原会议的参会人，时间不变',
  },
  {
    id: 'shorten',
    title: '缩短会议',
    core: false,
    opening: '下周四的设计评审缩短到 30 分钟，开始时间不变。',
    instruction: `${ME}你想把下周四（10 月 29 日）的设计评审从 1 小时缩短到 30 分钟，开始时间不变。${CONFIRM}`,
    expect: { creates: [], update: { id: 'evt-203', start: '2026-10-29T06:00:00Z', end: '2026-10-29T06:30:00Z' } },
    why: '只改结束时间',
  },
  {
    id: 'london-time-request',
    title: '按对方时区指定时间',
    core: false,
    opening: '明天伦敦时间上午 10 点，和 Oliver 开 30 分钟会。',
    instruction: `${ME}你想明天（10 月 22 日）伦敦时间上午 10 点和 Oliver 开 30 分钟的会，你也参加。${CONFIRM}`,
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [exact('2026-10-22T09:00:00.000Z', 30)], when: '伦敦时间 10 月 22 日 10:00（BST，即北京时间 17:00）' }] },
    why: '时间是按伦敦当地时间指定的（本周伦敦还是夏令时 UTC+1）',
  },
  {
    id: 'ambiguous-duration',
    title: '需求不清楚：先问再订',
    core: false,
    opening: '下周找个时间和 Oliver 聊聊吧。',
    instruction: `${ME}你想下周和 Oliver 聊聊。助手问你时长和时间时，你说“30 分钟就行，下周二北京时间下午都可以”。${CONFIRM}`,
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-27', '12:00', '18:00')], when: '10 月 27 日下午（北京时间）' }], mustAsk: true },
    why: '时长和日期都没说：要先问清楚（或给出具体方案请请求人确认），不能直接订',
  },
  {
    id: 'room-too-big',
    title: '没有足够大的会议室',
    core: false,
    opening: '下周一下午在北京订个能坐 20 个人的会议室开全员会，王磊、刘倩、张浩都参加。',
    instruction: `${ME}你想在下周一（10 月 26 日）下午订一个北京办公室能坐 20 人的会议室开全员会。如果助手说没有这么大的会议室，你就说“那我再想办法，这次先不订”，结束对话。`,
    expect: { creates: [] },
    why: '北京办公室最大的会议室只能坐 12 人：应该说明情况，不能订一个坐不下的会议室',
  },
  {
    id: 'london-room',
    title: '替别人订伦敦的会议室',
    core: false,
    opening: '帮 Oliver 和 Emma 在伦敦办公室订个有投影仪的会议室，明天开 1 小时，我不参加。',
    instruction: `${ME}你想帮 Oliver 和 Emma 在伦敦办公室订一个有投影仪的会议室，明天（伦敦时间 10 月 22 日）开 1 小时的会，时间随意，你不参加。${CONFIRM}`,
    expect: {
      creates: [{ attendees: who('Oliver', 'Emma'), minutes: 60, windows: [['2026-10-21T23:00:00.000Z', '2026-10-22T23:00:00.000Z']], when: '伦敦时间 10 月 22 日', room: { office: '伦敦', minCapacity: 2, equipment: '投影仪' } }],
    },
    why: '会议室要在伦敦、有投影仪；时间按伦敦同事的工作时间来',
  },
  {
    id: 'us-dst-ended',
    title: '美国夏令时结束之后',
    core: false,
    opening: '11 月 3 日（周二）北京时间上午 10:30 和 Sarah 开 30 分钟会。',
    instruction: `${ME}你想在 11 月 3 日（周二）北京时间上午 10:30 和 Sarah（旧金山）开 30 分钟的会，你也参加。${CONFIRM}`,
    expect: { creates: [{ attendees: who('陈雨', 'Sarah'), minutes: 30, windows: [exact('2026-11-03T02:30:00.000Z', 30)], when: '北京时间 11 月 3 日 10:30' }] },
    why: '旧金山 11 月 1 日已结束夏令时（UTC-8）：北京 10:30 是旧金山前一天 18:30，在 Sarah 的工作时间内（按夏令时算会误以为是 19:30）',
  },
  {
    id: 'weekly-3',
    title: '连续三周的 1:1',
    core: false,
    opening: '接下来三周，每周三上午 10 点（北京时间）和刘倩开 30 分钟 1:1。',
    instruction: `${ME}你想从下周三（10 月 28 日）开始，连续三周（10 月 28 日、11 月 4 日、11 月 11 日）每周三北京时间上午 10 点和刘倩开 30 分钟 1:1。${CONFIRM}`,
    expect: {
      creates: ['2026-10-28', '2026-11-04', '2026-11-11'].map((d) => ({ attendees: who('陈雨', '刘倩'), minutes: 30, windows: [exact(`${d}T02:00:00.000Z`, 30)], when: `${d} 10:00（北京时间）` })),
    },
    why: '三场会，每周三北京时间 10:00',
  },
  {
    id: 'cancel-no-notify',
    title: '取消自己的会',
    core: false,
    opening: '把周五上午的版本评审取消吧。',
    instruction: `${ME}你想取消本周五（10 月 23 日）上午的版本评审（只有你自己参加）。${CONFIRM}`,
    expect: { creates: [], cancel: { id: 'evt-202' } },
    why: '取消 10 月 23 日的版本评审',
  },
  {
    id: 'weekend-request',
    title: '周末不是工作日',
    core: false,
    opening: '这周六上午和王磊开个会。',
    instruction: `${ME}你想这周六上午和王磊开会。如果助手提醒周六不是工作日、问你改什么时间，你就说“那就下周一上午 11 点（北京时间），30 分钟”。${CONFIRM}`,
    expect: { creates: [{ attendees: who('陈雨', '王磊'), minutes: 30, windows: [exact('2026-10-26T03:00:00.000Z', 30)], when: '下周一北京时间 11:00' }], mustAsk: true },
    why: '周六不是工作日：要提醒请求人，按他的新选择（下周一 11:00，30 分钟）预订',
  },
]

// ———————————————— 模拟用户脚本（模拟模式） ————————————————

const DONE = /已(经)?(为您|帮您|给您)?(成功)?(预订|预定|创建|安排好|更新|修改|改到|改期|取消|订好|发出|订了|订)/
const IMPOSSIBLE = /无法|没有.{0,12}(共同|重叠|交集|满足)|找不到.{0,12}(时间|时段|会议室)|不在.{0,8}工作时间/
const OPTIONS = /冲突|已有安排|有安排|可选|选项|哪个|以下/
const ASK = /[？?]|确认|可以吗|是否|行吗|好吗/
const FAILED = /抱歉|失败|出错|错误/

export function makeScript(opening: string, s: ScriptSpec): SimUserSpec['script'] {
  return (msg, _turn, memory) => {
    const m = memory as { seen?: Record<string, number>; confused?: number; chose?: boolean }
    m.seen ??= {}
    m.seen[msg] = (m.seen[msg] ?? 0) + 1
    if (m.seen[msg] >= 3) return `你已经第三次说同样的话了……算了，我自己来吧。${STOP}`
    if (DONE.test(msg) && !ASK.test(msg.slice(-12))) return `好的，谢谢！${STOP}`
    if (s.onImpossible && IMPOSSIBLE.test(msg)) return `${s.onImpossible}${STOP}`
    for (const [re, ans] of s.answers ?? []) if (re.test(msg)) return ans
    if (s.choose && !m.chose && OPTIONS.test(msg) && ASK.test(msg)) {
      m.chose = true
      return s.choose
    }
    if (ASK.test(msg)) return s.confirm ?? '可以，就这么订。'
    if (FAILED.test(msg) || IMPOSSIBLE.test(msg)) return `那算了，我自己再想想。${STOP}`
    m.confused = (m.confused ?? 0) + 1
    if (m.confused >= 3) return `你好像没明白我的意思，算了。${STOP}`
    return `我的需求是：${opening}`
  }
}

export function userSpecOf(t: CalTaskSpec): SimUserSpec {
  return { opening: t.opening, instruction: t.instruction, script: t.script ? makeScript(t.opening, t.script) : () => STOP }
}

// ———————————————— 判定 ————————————————

const CONFIRMED = /确认|是的|^\s*是|好的|可以|没问题|对的|同意|^\s*行|^\s*嗯|就这么|订吧|就这样|\b(ok|okay|yes)\b/i
const DENIED = /不(要|用|行|对|是|确认|同意|可以)|别|先不|等等|再想/
const CHOICE = /\d{1,2}\s*[:：点]/
export const isConfirmOrChoice = (t: string) => (CONFIRMED.test(t) || CHOICE.test(t)) && !DENIED.test(t)

const nameOf = (addr: string) => PEOPLE.find((p) => p.email === addr)?.name ?? ROOMS.find((r) => r.id === addr)?.name ?? addr
const names = (xs: string[]) => xs.map(nameOf).join('、')
const bj = (ms: number, end?: number) => describeLocal(ms, 'Asia/Shanghai', end)
const dstHint = (tz: string, ms: number) =>
  tz === 'Europe/London' && ms >= Date.parse('2026-10-25T01:00:00Z')
    ? '注意：伦敦 10 月 25 日起已结束夏令时（UTC+1 → UTC+0）。'
    : tz === 'America/Los_Angeles' && ms >= Date.parse('2026-11-01T09:00:00Z')
      ? '注意：旧金山 11 月 1 日起已结束夏令时（UTC-7 → UTC-8）。'
      : ''

/** 检查一个会议本身是否合法：参会人工作时间、冲突 */
function constraintError(ev: CalEvent, all: CalEvent[]): string | null {
  const s = Date.parse(ev.start)
  const t = Date.parse(ev.end)
  for (const a of ev.attendees) {
    const p = PEOPLE.find((x) => x.email === a)
    if (!p) continue
    const ls = localOf(s, p.timezone)
    const le = localOf(t - 1, p.timezone)
    const ok = ls.date === le.date && ls.weekday >= 1 && ls.weekday <= 5 && ls.min >= toMin(p.workingHours.start) && le.min + 1 <= toMin(p.workingHours.end)
    if (!ok) {
      return `${p.name}（${p.office}，${p.timezone}）的工作时间是当地${p.workingDays} ${p.workingHours.start}–${p.workingHours.end}，但这个会议在他那里是 ${describeLocal(s, p.timezone, t)}。${dstHint(p.timezone, s)}时区换算要交给代码（Intl / 时区库）：工具里统一用带时区的 ISO 时间，把每个人的当地时间算好再给模型`
    }
  }
  for (const o of all) {
    if (o.id === ev.id || o.status !== 'confirmed') continue
    if (!(Date.parse(o.start) < t && s < Date.parse(o.end))) continue
    const common = o.attendees.filter((x) => ev.attendees.includes(x))
    if (common.length) return `和 ${names(common)} 已有的会议“${o.title}”（北京时间 ${bj(Date.parse(o.start), Date.parse(o.end))}）冲突。找时间之前要查所有参会人的忙闲`
    if (ev.room && o.room === ev.room) return `会议室 ${nameOf(ev.room)} 在这个时间已经被“${o.title}”占用（北京时间 ${bj(Date.parse(o.start), Date.parse(o.end))}）。会议室也要查忙闲`
  }
  return null
}

function createError(exp: CreateExpect, ev: CalEvent, all: CalEvent[]): string | null {
  const s = Date.parse(ev.start)
  const t = Date.parse(ev.end)
  if ((t - s) / 60_000 !== exp.minutes) return `时长应为 ${exp.minutes} 分钟，实际是 ${(t - s) / 60_000} 分钟`
  if (!exp.windows.some(([a, b]) => Date.parse(a) <= s && t <= Date.parse(b))) {
    const H8 = 8 * 3_600_000
    // 把北京时间的“裸时间”传给 API，会被当成 UTC：实际时间比本意晚 8 小时
    const off8 = exp.windows.some(([a, b]) => Date.parse(a) <= s - H8 && t - H8 <= Date.parse(b))
    const hint = off8
      ? '时间正好差了 8 小时：很可能把北京时间当成 UTC 传给了 createEvent。传给 API 的时间一定要带时区（例如 2026-10-22T08:30:00Z 或 +08:00）'
      : localOf(s, 'Asia/Shanghai').date.startsWith('2026-10') || localOf(s, 'Asia/Shanghai').date.startsWith('2026-11')
        ? '检查日期和请求人的要求（上午 / 下午、不开会的时间、请求人选择的时间……）'
        : '日期完全不对：模型不知道今天是哪天。把 env.now()（以及星期几）写进 system prompt'
    return `时间不对：应该在${exp.when}，实际是北京时间 ${bj(s, t)}。${hint}`
  }
  const want = [...exp.attendees].sort()
  const got = [...ev.attendees].sort()
  if (want.join() !== got.join()) {
    const missing = want.filter((x) => !got.includes(x))
    const extra = got.filter((x) => !want.includes(x))
    return `参会人不对：${missing.length ? `少了 ${names(missing)}` : ''}${missing.length && extra.length ? '，' : ''}${extra.length ? `多了 ${names(extra)}` : ''}（应为 ${names(want)}）。${missing.includes(REQUESTER.email) ? '请求人自己也参加时，要把他放进 attendees。' : ''}`
  }
  if (exp.room) {
    const r = ROOMS.find((x) => x.id === ev.room)
    if (!r) return `需要预订会议室（${exp.room.office}，至少 ${exp.room.minCapacity} 人${exp.room.equipment ? `，有${exp.room.equipment}` : ''}），但会议没有会议室。先用 listRooms 找合适的会议室，再通过 room 参数传给 createEvent`
    if (r.office !== exp.room.office) return `会议室 ${r.name} 在${r.office}办公室，应该在${exp.room.office}`
    if (r.capacity < Math.max(exp.room.minCapacity, ev.attendees.length)) return `会议室 ${r.name} 只能坐 ${r.capacity} 人，要求至少 ${exp.room.minCapacity} 人`
    if (exp.room.equipment && !r.equipment.includes(exp.room.equipment)) return `会议室 ${r.name} 没有${exp.room.equipment}（设备：${r.equipment.join('、')}）`
  }
  return constraintError(ev, all)
}

const fmtEv = (ev: CalEvent) => `“${ev.title}” 北京时间 ${bj(Date.parse(ev.start), Date.parse(ev.end))}，参会人 ${names(ev.attendees)}${ev.room ? `，会议室 ${nameOf(ev.room)}` : ''}`

export function checkTask(spec: CalTaskSpec, env: CalendarEnv): CheckResult {
  const st = stateOf(env)
  const exp = spec.expect
  const all = st.events
  const initial = new Map(EVENTS.map((e) => [e.id, e]))

  if (exp.mustAsk)
    for (const a of st.actions)
      if (a.turn < 1 || !isConfirmOrChoice(a.userText))
        return {
          pass: false,
          reason: `在请求人做出选择 / 确认之前就执行了写操作（${a.op} ${a.eventId}，请求人最近一句话：“${a.userText.slice(0, 40)}”）。${spec.why}。在 system prompt 里要求“先列出方案、等请求人确认后再执行”，并且问完问题就把这一轮交还给请求人`,
        }

  // 不该动的会议
  for (const e of all) {
    const before = initial.get(e.id)
    if (!before || JSON.stringify(before) === JSON.stringify(e)) continue
    if (exp.update?.id === e.id || exp.cancel?.id === e.id) continue
    return { pass: false, reason: `改动了不该改动的会议：${fmtEv(before)}${e.status === 'cancelled' ? ' 被取消了' : ` 被改成了 ${fmtEv(e)}`}。${spec.why}` }
  }

  const created = all.filter((e) => !initial.has(e.id) && e.status === 'confirmed')

  if (exp.cancel) {
    const e = all.find((x) => x.id === exp.cancel!.id)!
    if (e.status !== 'cancelled')
      return {
        pass: false,
        reason: `应该取消 ${fmtEv(initial.get(e.id)!)}，但它还在。${spec.why}。${st.actions.length ? '' : '对话中没有任何取消操作。常见原因：模型不知道今天是哪天（“下周一”算错了）、找不到会议 id、请求人确认后没有继续执行、每一轮没有带上对话历史、工具参数缺失。'}`,
      }
    const act = st.actions.find((a) => a.op === 'cancel' && a.eventId === e.id)
    if (exp.cancel.notify && !act?.notify) return { pass: false, reason: '取消会议时要通知参会人（cancelEvent 的 notifyAttendees: true，最好附上说明），请求人明确要求“跟大家说一声”' }
  }

  if (exp.update) {
    const u = exp.update
    const e = all.find((x) => x.id === u.id)!
    const before = initial.get(u.id)!
    if (created.length)
      return { pass: false, reason: `应该修改原会议（updateEvent ${u.id}），而不是新建：现在日历上多了 ${created.map(fmtEv).join('；')}${JSON.stringify(e) === JSON.stringify(before) ? '，原会议还在原来的时间' : ''}` }
    if (e.status !== 'confirmed') return { pass: false, reason: `应该修改会议 ${u.id}，但它被取消了` }
    if (Date.parse(e.start) !== Date.parse(u.start) || Date.parse(e.end) !== Date.parse(u.end))
      return {
        pass: false,
        reason: `会议“${e.title}”的时间应改为北京时间 ${bj(Date.parse(u.start), Date.parse(u.end))}，实际是 ${bj(Date.parse(e.start), Date.parse(e.end))}${
          JSON.stringify(e) === JSON.stringify(before)
            ? '（没有被修改过）。常见原因：模型不知道今天是哪天、找不到会议 id、请求人确认后没有继续执行、每一轮没有带上对话历史'
            : Date.parse(e.start) - Date.parse(u.start) === 8 * 3_600_000
              ? '。时间正好晚了 8 小时：很可能把北京时间当成 UTC 传给了 updateEvent。传给 API 的时间一定要带时区'
              : `。${spec.why}`
        }`,
      }
    const want = [...(u.attendees ?? before.attendees)].sort().join()
    if ([...e.attendees].sort().join() !== want) return { pass: false, reason: `会议“${e.title}”的参会人应为 ${names(u.attendees ?? before.attendees)}，实际是 ${names(e.attendees)}` }
    const bad = constraintError(e, all)
    if (bad) return { pass: false, reason: `修改后的会议不合规：${bad}` }
  }

  if (!exp.creates.length && created.length)
    return { pass: false, reason: `这个请求不应该新建会议（${spec.why}），却订了 ${created.map(fmtEv).join('；')}` }
  if (exp.creates.length) {
    if (!created.length)
      return {
        pass: false,
        reason: `没有预订会议：期望 ${exp.creates.length} 个（${exp.creates.map((c) => `${names(c.attendees)}，${c.minutes} 分钟，${c.when}`).join('；')}）。常见原因：模型不知道今天是哪天（日期算错，查不到空闲时间）；请求人确认后没有继续执行；每一轮没有带上之前的对话历史；找不到参会人的邮箱。`,
      }
    if (created.length !== exp.creates.length)
      return { pass: false, reason: `应该新建 ${exp.creates.length} 个会议，实际新建了 ${created.length} 个：${created.map(fmtEv).join('；')}` }
    const used = new Set<string>()
    for (const c of exp.creates) {
      const errs = created.filter((e) => !used.has(e.id)).map((e) => [e, createError(c, e, all)] as const)
      const hit = errs.find(([, err]) => !err)
      if (!hit) return { pass: false, reason: `${fmtEv(errs[0][0])}：${errs[0][1]}` }
      used.add(hit[0].id)
    }
  }

  if (exp.mustSay) {
    const said = st.user.transcript.filter((m) => m.role === 'agent').map((m) => m.text).join('\n')
    if (!exp.mustSay.re.test(said)) return { pass: false, reason: `没有向请求人${exp.mustSay.what}。${spec.why}` }
  }

  const done = [exp.creates.length ? `新建 ${exp.creates.length} 个会议` : '', exp.update ? '修改原会议' : '', exp.cancel ? '取消会议' : ''].filter(Boolean).join('、')
  return { pass: true, reason: done ? `完成：${done}，所有约束都满足` : '没有违规预订，正确说明了情况' }
}

export function toTasks(): ProjectTask<CalendarEnv, void>[] {
  return TASK_SPECS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    core: spec.core,
    input: spec,
    check: ({ env }) => checkTask(spec, env),
  }))
}

