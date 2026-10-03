/**
 * P4 任务集：每个任务 = 一位提需求的同事（模拟用户）+ 期望的日历最终状态。
 * 判定只看结果（与模型无关）：
 *   1. 最终日历：该建的会建了（参会人、时长、时间窗口、会议室都对），该改的改了（原会议被移动而不是复制一份），该取消的取消了；
 *      不该动的会议一个都没动；
 *   2. 约束：每个会议都在**每位参会人当地的工作时间**内（按 IANA 时区换算，含夏令时），不和任何参会人 / 会议室的其它会议冲突；
 *   3. 流程：需要请求人做选择 / 确认的任务，写操作必须发生在请求人明确选择或确认之后（来自 action log）。
 */
import { L } from '../../engine/locale'
import { STOP, type SimUserSpec } from '../usersim'
import type { CheckResult, ProjectTask } from '../types'
import { EQUIP, EVENTS, OFFICES, PEOPLE, REQUESTER, ROOMS, email, type CalEvent } from './env/data'
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

const ME = L(
  '你是棱镜游戏的制作人陈雨（chen.yu@prismgames.com），在北京办公室工作，正在用公司的会议日程助手安排会议。',
  "You are Chen Yu (chen.yu@prismgames.com), a producer at Prism Games working in the Beijing office, using the company's meeting assistant to schedule meetings. ",
)
const CONFIRM = L('助手列出会议详情请你确认时，核对无误就回复“可以，就这么订”。办完后道谢并结束对话。', 'When the assistant lists the meeting details for you to confirm, check them and reply "Yes, go ahead." Once it\'s done, say thanks and end the conversation.')

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
    title: L('跨三地约 30 分钟', '30 minutes across time zones'),
    core: true,
    opening: L('帮我约一下王磊和 Oliver，明天找 30 分钟聊聊海外版本的发布计划，我也参加。', 'Set up 30 minutes tomorrow with Wang Lei and Oliver to go over the overseas launch plan. I\'ll join too.'),
    instruction: L(`${ME}你想明天（10 月 22 日，周四）和王磊（北京）、Oliver（伦敦）开一个 30 分钟的会，聊海外版本的发布计划，你自己也参加。时间不限，只要大家都在工作时间、都有空就行。${CONFIRM}`, `${ME}You want a 30-minute meeting tomorrow (Thursday, October 22) with Wang Lei (Beijing) and Oliver (London) about the overseas launch plan, and you'll attend. Any time works as long as everyone is within working hours and free. ${CONFIRM}`),
    script: {},
    expect: { creates: [{ attendees: who('陈雨', '王磊', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-22')], when: L('明天（10 月 22 日，北京时间）', 'tomorrow (October 22, Beijing time)') }] },
    why: L('三个人的工作时间（北京 / 伦敦）要换算到同一个时区再找交集，还要避开各自已有的会议', 'Everyone\'s working hours (Beijing / London) must be converted to one time zone to find the overlap, while avoiding their existing meetings'),
  },
  {
    id: 'reschedule',
    title: L('改期：移动原会议', 'Reschedule: move the original meeting'),
    core: true,
    opening: L('明天下午我和 Emma 的 1:1 挪到周五同一时间吧。', 'Move my 1:1 with Emma tomorrow afternoon to Friday, same time.'),
    instruction: L(`${ME}你明天（10 月 22 日）下午 4 点（北京时间）和 Emma 有一个 1:1，想挪到本周五（10 月 23 日）同一时间。${CONFIRM}`, `${ME}You have a 1:1 with Emma tomorrow (October 22) at 4 p.m. Beijing time and want to move it to this Friday (October 23) at the same time. ${CONFIRM}`),
    script: {},
    expect: { creates: [], update: { id: 'evt-201', start: '2026-10-23T08:00:00Z', end: '2026-10-23T08:30:00Z' } },
    why: L('改期要修改原来的会议（updateEvent），而不是新建一个——否则日历上会出现两个 1:1', 'Rescheduling must modify the original meeting (updateEvent), not create a new one — otherwise there are two 1:1s on the calendar'),
  },
  {
    id: 'room-projector',
    title: L('订有投影仪的会议室', 'Book a room with a projector'),
    core: true,
    opening: L('明天下午和刘倩、张浩开 1 小时的美术评审，我也参加，在北京办公室订个至少能坐 8 个人、有投影仪的会议室。', 'Book a 1-hour art review tomorrow afternoon with Liu Qian and Zhang Hao, I\'ll join too. Get a room in the Beijing office that seats at least 8 and has a projector.'),
    instruction: L(`${ME}你想明天（10 月 22 日）下午（北京时间）和刘倩、张浩开 1 小时的美术评审会，你也参加。需要北京办公室的会议室：至少 8 人、有投影仪。${CONFIRM}`, `${ME}You want a 1-hour art review tomorrow afternoon (October 22, Beijing time) with Liu Qian and Zhang Hao, and you'll attend. You need a room in the Beijing office that seats at least 8 and has a projector. ${CONFIRM}`),
    script: {},
    expect: {
      creates: [{ attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-22', '12:00', '18:00')], when: L('明天（10 月 22 日）下午（北京时间）', 'tomorrow afternoon (October 22, Beijing time)'), room: { office: OFFICES.bj, minCapacity: 8, equipment: EQUIP.projector } }],
    },
    why: L('会议室要满足容量、设备、所在办公室，并且在那个时间段没有被占用', 'The room must be in the right office, have the capacity and equipment, and be free at that time'),
  },
  {
    id: 'no-friday-pm',
    title: L('遵守“周五下午不开会”', 'Respect "no meetings on Friday afternoons"'),
    core: true,
    opening: L('这周五或者下周一，帮我和刘倩、张浩约 1 小时同步一下进度。对了，我周五下午不开会。', 'This Friday or next Monday, set up a 1-hour progress sync with Liu Qian and Zhang Hao. Oh, and I don\'t take meetings on Friday afternoons.'),
    instruction: L(`${ME}你想在本周五（10 月 23 日）或下周一（10 月 26 日）和刘倩、张浩开 1 小时的进度同步会，你也参加。你有个习惯：周五下午（北京时间 12 点以后）不开会。${CONFIRM}`, `${ME}You want a 1-hour progress sync with Liu Qian and Zhang Hao this Friday (October 23) or next Monday (October 26), and you'll attend. You have a habit: no meetings on Friday afternoons (after 12:00 Beijing time). ${CONFIRM}`),
    script: {},
    expect: {
      creates: [{ attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-23', '00:00', '12:00'), bjDay('2026-10-26')], when: L('周五上午或下周一（北京时间；请求人周五下午不开会）', 'Friday morning or next Monday (Beijing time; the requester takes no meetings on Friday afternoons)') }],
    },
    why: L('请求人说了“周五下午不开会”，最早的空闲时间恰好在周五下午，不能选', 'The requester said no meetings on Friday afternoons, and the earliest free slot happens to be Friday afternoon — it must not be picked'),
  },
  {
    id: 'conflict-choose',
    title: L('指定时间有冲突：让请求人选', 'Requested time conflicts: let the requester choose'),
    core: true,
    opening: L('明天上午 10 点（北京时间）和王磊开 30 分钟会，聊下引擎升级。', 'Set up a 30-minute meeting with Wang Lei tomorrow at 10 a.m. Beijing time to talk about the engine upgrade.'),
    instruction: L(`${ME}你想明天（10 月 22 日）上午 10 点（北京时间）和王磊开 30 分钟的会，你也参加。如果助手说 10 点有冲突、给你几个选项，你就选 11:00。${CONFIRM}`, `${ME}You want a 30-minute meeting with Wang Lei tomorrow (October 22) at 10 a.m. Beijing time, and you'll attend. If the assistant says 10:00 has a conflict and gives you options, pick 11:00. ${CONFIRM}`),
    script: { choose: L('那就 11:00 吧。', 'Let\'s do 11:00 then.') },
    expect: { creates: [{ attendees: who('陈雨', '王磊'), minutes: 30, windows: [exact('2026-10-22T03:00:00.000Z', 30)], when: L('明天北京时间 11:00（请求人在冲突后选择的时间）', 'tomorrow at 11:00 Beijing time (the time the requester picked after the conflict)') }], mustAsk: true },
    why: L('王磊 10:00 已有安排：要告诉请求人并给出选项，由请求人决定（他会选 11:00），不能自作主张订 10:30', 'Wang Lei is busy at 10:00: tell the requester and offer options so they decide (they\'ll pick 11:00) — don\'t book 10:30 on your own'),
  },
  {
    id: 'cancel-notify',
    title: L('取消会议并通知参会人', 'Cancel a meeting and notify attendees'),
    core: true,
    opening: L('下周一的项目周会取消吧，跟大家说一声，改期另行通知。', 'Cancel next Monday\'s weekly project sync and let everyone know — we\'ll find a new time later.'),
    instruction: L(`${ME}你想取消下周一（10 月 26 日）的项目周会（只取消这一次，11 月 2 日那次保留），并通知参会人“改期另行通知”。${CONFIRM}`, `${ME}You want to cancel next Monday's (October 26) weekly project sync — just that one; keep the November 2 one — and tell the attendees it will be rescheduled later. ${CONFIRM}`),
    script: {},
    expect: { creates: [], cancel: { id: 'evt-101', notify: true }, mustAsk: true },
    why: L('要取消的是 10 月 26 日那一次项目周会（不是上周、也不是 11 月 2 日的），取消前要确认，取消时要通知参会人', 'Cancel the October 26 weekly project sync (not last week\'s, not the November 2 one); confirm before cancelling and notify the attendees'),
  },
  {
    id: 'dst-next-week',
    title: L('夏令时陷阱：下周的伦敦', 'DST trap: London next week'),
    core: true,
    opening: L('下周一（10 月 26 日）下午帮我和 Oliver 约 30 分钟。', 'Next Monday (October 26) afternoon, set up 30 minutes with Oliver for me.'),
    instruction: L(`${ME}你想在下周一（10 月 26 日）下午（北京时间）和 Oliver（伦敦）开 30 分钟的会，你也参加。${CONFIRM}`, `${ME}You want a 30-minute meeting with Oliver (London) next Monday afternoon (October 26, Beijing time), and you'll attend. ${CONFIRM}`),
    script: {},
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-26', '12:00', '18:00')], when: L('10 月 26 日下午（北京时间）', 'the afternoon of October 26 (Beijing time)') }] },
    why: L('伦敦 10 月 25 日结束夏令时（UTC+1 → UTC+0）。按“今天”的时差去算下周，会把会议订在 Oliver 上班之前', 'London leaves daylight saving time on October 25 (UTC+1 → UTC+0). Converting next week with today\'s offset books the meeting before Oliver starts work'),
  },
  {
    id: 'impossible',
    title: L('找不到共同时间：解释并给替代方案', 'No common time: explain and offer alternatives'),
    core: true,
    opening: L('明天和 Sarah、Oliver 一起开 1 小时的会，我也参加。', 'Tomorrow, a 1-hour meeting with Sarah and Oliver. I\'ll join too.'),
    instruction: L(`${ME}你想明天和 Sarah（旧金山）、Oliver（伦敦）三个人一起开 1 小时的会。如果助手说找不到大家都在工作时间的时段、给出替代方案，你就说“好的，那我先分别跟他们约，这次先不订了”，然后结束对话。不要接受任何在别人工作时间以外的安排。`, `${ME}You want a 1-hour meeting tomorrow with Sarah (San Francisco) and Oliver (London), the three of you. If the assistant says there's no slot within everyone's working hours and offers alternatives, say "OK, I'll meet them separately then — let's not book this one." and end the conversation. Don't accept anything outside someone's working hours.`),
    script: { onImpossible: L('好的，那我先分别跟他们约，这次先不订了。', 'OK, I\'ll meet them separately then — let\'s not book this one.') },
    expect: { creates: [], mustSay: { re: /工作时间|时区|重叠|交集|共同|上班|working hours|time ?zones?|overlap|in common/i, what: L('解释为什么找不到时间（三地的工作时间没有交集）', "explain why there's no time (the three offices' working hours don't overlap)") } },
    why: L('北京、伦敦、旧金山三地的工作时间没有共同的 1 小时：应该说明原因、给出替代方案（例如分开开），不能擅自订一个有人不在工作时间的会', 'Beijing, London and San Francisco working hours share no common hour: explain why and offer alternatives (e.g. separate meetings) — never book something outside someone\'s working hours'),
  },

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  {
    id: 'two-sessions',
    title: L('一次订两场培训', 'Book two training sessions at once'),
    core: false,
    opening: L('下周二和下周四上午，各订一场 1 小时的新人培训，刘倩、张浩参加，我也参加。', 'Next Tuesday morning and next Thursday morning, book a 1-hour onboarding session each. Liu Qian and Zhang Hao attend, and so do I.'),
    instruction: L(`${ME}你想在下周二（10 月 27 日）上午和下周四（10 月 29 日）上午（北京时间）各订一场 1 小时的新人培训，参会人：你、刘倩、张浩。不需要会议室。${CONFIRM}`, `${ME}You want two 1-hour onboarding sessions, next Tuesday morning (October 27) and next Thursday morning (October 29), Beijing time. Attendees: you, Liu Qian, Zhang Hao. No room needed. ${CONFIRM}`),
    expect: {
      creates: [
        { attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-27', '00:00', '12:00')], when: L('10 月 27 日上午（北京时间）', 'the morning of October 27 (Beijing time)') },
        { attendees: who('陈雨', '刘倩', '张浩'), minutes: 60, windows: [bjDay('2026-10-29', '00:00', '12:00')], when: L('10 月 29 日上午（北京时间）', 'the morning of October 29 (Beijing time)') },
      ],
    },
    why: L('两场会各自要满足约束，不能重复预订', 'Each session must satisfy the constraints on its own, with no duplicate bookings'),
  },
  {
    id: 'date-boundary',
    title: L('跨日期线：北京周五 = 旧金山周四', 'Across the date line: Beijing Friday = SF Thursday'),
    core: false,
    opening: L('帮张浩和 Sarah 约个 30 分钟的会，北京时间周五，我不参加。', 'Set up a 30-minute meeting for Zhang Hao and Sarah on Friday, Beijing time. I won\'t attend.'),
    instruction: L(`${ME}你想帮张浩（北京）和 Sarah（旧金山）约一个 30 分钟的会，时间在北京时间本周五（10 月 23 日），你自己不参加。${CONFIRM}`, `${ME}You want to set up a 30-minute meeting for Zhang Hao (Beijing) and Sarah (San Francisco) on Friday, October 23, Beijing time. You won't attend. ${CONFIRM}`),
    expect: { creates: [{ attendees: who('张浩', 'Sarah'), minutes: 30, windows: [bjDay('2026-10-23')], when: L('北京时间 10 月 23 日（周五）', 'October 23 (Friday), Beijing time') }] },
    why: L('北京周五早上是旧金山周四晚上：只有北京 9:30–10:00 这半小时同时落在两人的工作时间里', 'Friday morning in Beijing is Thursday evening in San Francisco: only 9:30–10:00 Beijing time falls within both working hours'),
  },
  {
    id: 'room-video',
    title: L('视频会议室 + 三人跨时区', 'Video room + three people across time zones'),
    core: false,
    opening: L('下周三和 Oliver、Emma 开 1 小时视频会，我也参加，在北京订一个有视频会议设备的会议室。', 'Next Wednesday, a 1-hour video call with Oliver and Emma. I\'ll join too — book a room with video conferencing in Beijing.'),
    instruction: L(`${ME}你想在下周三（10 月 28 日）和 Oliver、Emma（都在伦敦）开 1 小时的视频会，你也参加，需要北京办公室有视频会议设备的会议室。${CONFIRM}`, `${ME}You want a 1-hour video call next Wednesday (October 28) with Oliver and Emma (both in London), and you'll attend. You need a room with video conferencing in the Beijing office. ${CONFIRM}`),
    expect: {
      creates: [{ attendees: who('陈雨', 'Oliver', 'Emma'), minutes: 60, windows: [bjDay('2026-10-28')], when: L('10 月 28 日（北京时间）', 'October 28 (Beijing time)'), room: { office: OFFICES.bj, minCapacity: 1, equipment: EQUIP.video } }],
    },
    why: L('伦敦已切换到冬令时：三人的共同工作时间只剩北京 17:00–18:00 这一小时', 'London is on winter time by then: the three share only one hour of working time, 17:00–18:00 Beijing time'),
  },
  {
    id: 'reschedule-conflict',
    title: L('改期目标时间有冲突', 'Reschedule target has a conflict'),
    core: false,
    opening: L('下周一的项目周会改到下周二同一时间。', 'Move next Monday\'s weekly project sync to next Tuesday, same time.'),
    instruction: L(`${ME}你想把下周一（10 月 26 日）上午 9 点的项目周会改到下周二（10 月 27 日）同一时间。如果助手说有人冲突，你就说“那改到周二上午 11 点（北京时间）”。${CONFIRM}`, `${ME}You want to move the weekly project sync from next Monday (October 26) 9 a.m. to next Tuesday (October 27) at the same time. If the assistant says someone has a conflict, say "Then make it Tuesday at 11 a.m. Beijing time." ${CONFIRM}`),
    expect: { creates: [], update: { id: 'evt-101', start: '2026-10-27T03:00:00Z', end: '2026-10-27T04:00:00Z' }, mustAsk: true },
    why: L('周二 9 点刘倩有安排：要告诉请求人，按他的选择改到周二 11 点，并且是修改原会议', 'Liu Qian is busy Tuesday at 9: tell the requester, move it to Tuesday at 11 as they choose, and modify the original meeting'),
  },
  {
    id: 'cancel-not-organizer',
    title: L('不能取消别人组织的会', 'Can\'t cancel someone else\'s meeting'),
    core: false,
    opening: L('把下周二王磊那个引擎升级讨论取消掉吧，我去不了。', 'Cancel Wang Lei\'s engine upgrade discussion next Tuesday, I can\'t make it.'),
    instruction: L(`${ME}你想取消下周二（10 月 27 日）的“引擎升级讨论”，但这个会是王磊组织的。如果助手说只有组织者能取消，你就说“那我自己跟王磊说吧”，结束对话。`, `${ME}You want to cancel the "Engine upgrade discussion" next Tuesday (October 27), but Wang Lei organized it. If the assistant says only the organizer can cancel it, say "Fine, I'll tell Wang Lei myself." and end the conversation.`),
    expect: { creates: [] },
    why: L('这个会议的组织者是王磊，只有组织者能取消；应该向请求人说明，而不是想别的办法改动它', 'Wang Lei organized this meeting and only the organizer can cancel it; explain that to the requester instead of finding another way to change it'),
  },
  {
    id: 'add-attendee',
    title: L('给已有会议加人', 'Add someone to an existing meeting'),
    core: false,
    opening: L('下周四的设计评审把王磊也加上。', 'Add Wang Lei to next Thursday\'s design review.'),
    instruction: L(`${ME}你想把下周四（10 月 29 日）下午的设计评审加上王磊，时间不变。${CONFIRM}`, `${ME}You want to add Wang Lei to next Thursday's (October 29) afternoon design review; the time stays the same. ${CONFIRM}`),
    expect: { creates: [], update: { id: 'evt-203', start: '2026-10-29T06:00:00Z', end: '2026-10-29T07:00:00Z', attendees: who('陈雨', '刘倩', '张浩', '王磊') } },
    why: L('修改原会议的参会人，时间不变', 'Modify the original meeting\'s attendees; keep the time'),
  },
  {
    id: 'shorten',
    title: L('缩短会议', 'Shorten a meeting'),
    core: false,
    opening: L('下周四的设计评审缩短到 30 分钟，开始时间不变。', 'Shorten next Thursday\'s design review to 30 minutes, same start time.'),
    instruction: L(`${ME}你想把下周四（10 月 29 日）的设计评审从 1 小时缩短到 30 分钟，开始时间不变。${CONFIRM}`, `${ME}You want to shorten next Thursday's (October 29) design review from 1 hour to 30 minutes, keeping the start time. ${CONFIRM}`),
    expect: { creates: [], update: { id: 'evt-203', start: '2026-10-29T06:00:00Z', end: '2026-10-29T06:30:00Z' } },
    why: L('只改结束时间', 'Only the end time changes'),
  },
  {
    id: 'london-time-request',
    title: L('按对方时区指定时间', 'Time given in the other person\'s time zone'),
    core: false,
    opening: L('明天伦敦时间上午 10 点，和 Oliver 开 30 分钟会。', 'Tomorrow at 10 a.m. London time, a 30-minute meeting with Oliver.'),
    instruction: L(`${ME}你想明天（10 月 22 日）伦敦时间上午 10 点和 Oliver 开 30 分钟的会，你也参加。${CONFIRM}`, `${ME}You want a 30-minute meeting with Oliver tomorrow (October 22) at 10 a.m. London time, and you'll attend. ${CONFIRM}`),
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [exact('2026-10-22T09:00:00.000Z', 30)], when: L('伦敦时间 10 月 22 日 10:00（BST，即北京时间 17:00）', '10:00 London time on October 22 (BST, i.e. 17:00 Beijing time)') }] },
    why: L('时间是按伦敦当地时间指定的（本周伦敦还是夏令时 UTC+1）', 'The time is given in London local time (London is still on summer time UTC+1 this week)'),
  },
  {
    id: 'ambiguous-duration',
    title: L('需求不清楚：先问再订', 'Unclear request: ask before booking'),
    core: false,
    opening: L('下周找个时间和 Oliver 聊聊吧。', 'Find some time next week for me to chat with Oliver.'),
    instruction: L(`${ME}你想下周和 Oliver 聊聊。助手问你时长和时间时，你说“30 分钟就行，下周二北京时间下午都可以”。${CONFIRM}`, `${ME}You want to chat with Oliver next week. When the assistant asks about duration and time, say "30 minutes is fine; any time next Tuesday afternoon Beijing time works." ${CONFIRM}`),
    expect: { creates: [{ attendees: who('陈雨', 'Oliver'), minutes: 30, windows: [bjDay('2026-10-27', '12:00', '18:00')], when: L('10 月 27 日下午（北京时间）', 'the afternoon of October 27 (Beijing time)') }], mustAsk: true },
    why: L('时长和日期都没说：要先问清楚（或给出具体方案请请求人确认），不能直接订', 'Neither duration nor date was given: ask first (or propose a concrete plan for the requester to confirm) — don\'t book straight away'),
  },
  {
    id: 'room-too-big',
    title: L('没有足够大的会议室', 'No room is big enough'),
    core: false,
    opening: L('下周一下午在北京订个能坐 20 个人的会议室开全员会，王磊、刘倩、张浩都参加。', 'Next Monday afternoon, book a room in Beijing that seats 20 for an all-hands. Wang Lei, Liu Qian and Zhang Hao will all attend.'),
    instruction: L(`${ME}你想在下周一（10 月 26 日）下午订一个北京办公室能坐 20 人的会议室开全员会。如果助手说没有这么大的会议室，你就说“那我再想办法，这次先不订”，结束对话。`, `${ME}You want to book a room in the Beijing office that seats 20 for an all-hands next Monday afternoon (October 26). If the assistant says there's no room that big, say "I'll figure something else out — let's not book anything for now." and end the conversation.`),
    expect: { creates: [] },
    why: L('北京办公室最大的会议室只能坐 12 人：应该说明情况，不能订一个坐不下的会议室', 'The largest room in the Beijing office seats 12: explain that instead of booking a room that\'s too small'),
  },
  {
    id: 'london-room',
    title: L('替别人订伦敦的会议室', 'Book a London room for others'),
    core: false,
    opening: L('帮 Oliver 和 Emma 在伦敦办公室订个有投影仪的会议室，明天开 1 小时，我不参加。', 'Book a room with a projector in the London office for Oliver and Emma, 1 hour tomorrow. I won\'t attend.'),
    instruction: L(`${ME}你想帮 Oliver 和 Emma 在伦敦办公室订一个有投影仪的会议室，明天（伦敦时间 10 月 22 日）开 1 小时的会，时间随意，你不参加。${CONFIRM}`, `${ME}You want to book a room with a projector in the London office for Oliver and Emma, for a 1-hour meeting tomorrow (October 22, London time). Any time works; you won't attend. ${CONFIRM}`),
    expect: {
      creates: [{ attendees: who('Oliver', 'Emma'), minutes: 60, windows: [['2026-10-21T23:00:00.000Z', '2026-10-22T23:00:00.000Z']], when: L('伦敦时间 10 月 22 日', 'October 22, London time'), room: { office: OFFICES.ldn, minCapacity: 2, equipment: EQUIP.projector } }],
    },
    why: L('会议室要在伦敦、有投影仪；时间按伦敦同事的工作时间来', 'The room must be in London with a projector; the time follows the London colleagues\' working hours'),
  },
  {
    id: 'us-dst-ended',
    title: L('美国夏令时结束之后', 'After US daylight saving ends'),
    core: false,
    opening: L('11 月 3 日（周二）北京时间上午 10:30 和 Sarah 开 30 分钟会。', 'November 3 (Tuesday) at 10:30 a.m. Beijing time, a 30-minute meeting with Sarah.'),
    instruction: L(`${ME}你想在 11 月 3 日（周二）北京时间上午 10:30 和 Sarah（旧金山）开 30 分钟的会，你也参加。${CONFIRM}`, `${ME}You want a 30-minute meeting with Sarah (San Francisco) on Tuesday, November 3 at 10:30 a.m. Beijing time, and you'll attend. ${CONFIRM}`),
    expect: { creates: [{ attendees: who('陈雨', 'Sarah'), minutes: 30, windows: [exact('2026-11-03T02:30:00.000Z', 30)], when: L('北京时间 11 月 3 日 10:30', '10:30 Beijing time on November 3') }] },
    why: L('旧金山 11 月 1 日已结束夏令时（UTC-8）：北京 10:30 是旧金山前一天 18:30，在 Sarah 的工作时间内（按夏令时算会误以为是 19:30）', 'San Francisco left daylight saving time on November 1 (UTC-8): 10:30 in Beijing is 18:30 the previous day in San Francisco, within Sarah\'s working hours (with DST you\'d wrongly get 19:30)'),
  },
  {
    id: 'weekly-3',
    title: L('连续三周的 1:1', 'Three weekly 1:1s'),
    core: false,
    opening: L('接下来三周，每周三上午 10 点（北京时间）和刘倩开 30 分钟 1:1。', 'For the next three weeks, a 30-minute 1:1 with Liu Qian every Wednesday at 10 a.m. Beijing time.'),
    instruction: L(`${ME}你想从下周三（10 月 28 日）开始，连续三周（10 月 28 日、11 月 4 日、11 月 11 日）每周三北京时间上午 10 点和刘倩开 30 分钟 1:1。${CONFIRM}`, `${ME}Starting next Wednesday (October 28), you want a 30-minute 1:1 with Liu Qian every Wednesday at 10 a.m. Beijing time for three weeks (October 28, November 4, November 11). ${CONFIRM}`),
    expect: {
      creates: ['2026-10-28', '2026-11-04', '2026-11-11'].map((d) => ({ attendees: who('陈雨', '刘倩'), minutes: 30, windows: [exact(`${d}T02:00:00.000Z`, 30)], when: L(`${d} 10:00（北京时间）`, `${d} 10:00 (Beijing time)`) })),
    },
    why: L('三场会，每周三北京时间 10:00', 'Three meetings, every Wednesday at 10:00 Beijing time'),
  },
  {
    id: 'cancel-no-notify',
    title: L('取消自己的会', 'Cancel your own meeting'),
    core: false,
    opening: L('把周五上午的版本评审取消吧。', 'Cancel Friday morning\'s release review.'),
    instruction: L(`${ME}你想取消本周五（10 月 23 日）上午的版本评审（只有你自己参加）。${CONFIRM}`, `${ME}You want to cancel this Friday's (October 23) morning release review (you're the only attendee). ${CONFIRM}`),
    expect: { creates: [], cancel: { id: 'evt-202' } },
    why: L('取消 10 月 23 日的版本评审', 'Cancel the October 23 release review'),
  },
  {
    id: 'weekend-request',
    title: L('周末不是工作日', 'Weekends aren\'t workdays'),
    core: false,
    opening: L('这周六上午和王磊开个会。', 'Set up a meeting with Wang Lei this Saturday morning.'),
    instruction: L(`${ME}你想这周六上午和王磊开会。如果助手提醒周六不是工作日、问你改什么时间，你就说“那就下周一上午 11 点（北京时间），30 分钟”。${CONFIRM}`, `${ME}You want a meeting with Wang Lei this Saturday morning. If the assistant reminds you Saturday isn't a workday and asks for another time, say "Then next Monday at 11:00 Beijing time, 30 minutes." ${CONFIRM}`),
    expect: { creates: [{ attendees: who('陈雨', '王磊'), minutes: 30, windows: [exact('2026-10-26T03:00:00.000Z', 30)], when: L('下周一北京时间 11:00', 'next Monday at 11:00 Beijing time') }], mustAsk: true },
    why: L('周六不是工作日：要提醒请求人，按他的新选择（下周一 11:00，30 分钟）预订', 'Saturday isn\'t a workday: point that out and book the requester\'s new choice (next Monday 11:00, 30 minutes)'),
  },
]

// ———————————————— 模拟用户脚本（模拟模式） ————————————————

// 中英文都认：真实模型可能用任何一种语言回复
const DONE =
  /已(经)?(为您|帮您|给您)?(成功)?(预订|预定|创建|安排好|更新|修改|改到|改期|取消|订好|发出|订了|订)|\b(I'?ve|I have|has been|have been|is now|successfully)\b[^.?!\n]{0,40}\b(booked|scheduled|created|rescheduled|moved|updated|cancell?ed)\b|^\s*(done|booked|rescheduled|cancell?ed)\b/im
const IMPOSSIBLE =
  /无法|没有.{0,12}(共同|重叠|交集|满足)|找不到.{0,12}(时间|时段|会议室)|不在.{0,8}工作时间|\b(couldn'?t|can'?t|cannot|unable to)\b[^.?!\n]{0,20}\bfind\b|\bno\b[^.?!\n]{0,20}\b(common|overlapping|shared|available)\b|don'?t overlap|no overlap|outside[^.?!\n]{0,20}working hours/i
const OPTIONS = /冲突|已有安排|有安排|可选|选项|哪个|以下|conflict|already (has|have|booked)|\bbusy\b|options?\b|which (one|works|would|do you)|alternatives?/i
const ASK = /[？?]|确认|可以吗|是否|行吗|好吗|\bconfirm\b|shall I|should I/i
const FAILED = /抱歉|失败|出错|错误|\bsorry\b|\bfailed\b|\berror\b/i

export function makeScript(opening: string, s: ScriptSpec): SimUserSpec['script'] {
  return (msg, _turn, memory) => {
    const m = memory as { seen?: Record<string, number>; confused?: number; chose?: boolean }
    m.seen ??= {}
    m.seen[msg] = (m.seen[msg] ?? 0) + 1
    if (m.seen[msg] >= 3) return `${L('你已经第三次说同样的话了……算了，我自己来吧。', "That's the third time you've said the same thing… never mind, I'll do it myself.")}${STOP}`
    if (DONE.test(msg) && !ASK.test(msg.slice(-12))) return `${L('好的，谢谢！', 'Great, thanks!')}${STOP}`
    if (s.onImpossible && IMPOSSIBLE.test(msg)) return `${s.onImpossible}${STOP}`
    for (const [re, ans] of s.answers ?? []) if (re.test(msg)) return ans
    if (s.choose && !m.chose && OPTIONS.test(msg) && ASK.test(msg)) {
      m.chose = true
      return s.choose
    }
    if (ASK.test(msg)) return s.confirm ?? L('可以，就这么订。', 'Yes, go ahead.')
    if (FAILED.test(msg) || IMPOSSIBLE.test(msg)) return `${L('那算了，我自己再想想。', "Never mind, I'll figure it out myself.")}${STOP}`
    m.confused = (m.confused ?? 0) + 1
    if (m.confused >= 3) return `${L('你好像没明白我的意思，算了。', "I don't think you got what I meant. Never mind.")}${STOP}`
    return `${L('我的需求是：', 'What I need: ')}${opening}`
  }
}

export function userSpecOf(t: CalTaskSpec): SimUserSpec {
  return { opening: t.opening, instruction: t.instruction, script: t.script ? makeScript(t.opening, t.script) : () => STOP }
}

// ———————————————— 判定 ————————————————

const CONFIRMED =
  /确认|是的|^\s*是|好的|可以|没问题|对的|同意|^\s*行|^\s*嗯|就这么|订吧|就这样|\b(ok|okay|yes)\b|\b(yep|yeah|sure|confirm(ed)?|correct|go ahead|sounds good|looks good|that works|works for me|perfect|book it|do it)\b/i
const DENIED = /不(要|用|行|对|是|确认|同意|可以)|别|先不|等等|再想|\b(don'?t|do not|not yet|wait|hold on|never ?mind)\b|^\s*no\b/i
const CHOICE = /\d{1,2}\s*[:：点]|\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.|o'?clock)/i
export const isConfirmOrChoice = (t: string) => (CONFIRMED.test(t) || CHOICE.test(t)) && !DENIED.test(t)

const nameOf = (addr: string) => PEOPLE.find((p) => p.email === addr)?.name ?? ROOMS.find((r) => r.id === addr)?.name ?? addr
const names = (xs: string[]) => xs.map(nameOf).join(L('、', ', '))
const bj = (ms: number, end?: number) => describeLocal(ms, 'Asia/Shanghai', end)
const dstHint = (tz: string, ms: number) =>
  tz === 'Europe/London' && ms >= Date.parse('2026-10-25T01:00:00Z')
    ? L('注意：伦敦 10 月 25 日起已结束夏令时（UTC+1 → UTC+0）。', 'Note: London left daylight saving time on October 25 (UTC+1 → UTC+0). ')
    : tz === 'America/Los_Angeles' && ms >= Date.parse('2026-11-01T09:00:00Z')
      ? L('注意：旧金山 11 月 1 日起已结束夏令时（UTC-7 → UTC-8）。', 'Note: San Francisco left daylight saving time on November 1 (UTC-7 → UTC-8). ')
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
      return L(
        `${p.name}（${p.office}，${p.timezone}）的工作时间是当地${p.workingDays} ${p.workingHours.start}–${p.workingHours.end}，但这个会议在他那里是 ${describeLocal(s, p.timezone, t)}。${dstHint(p.timezone, s)}时区换算要交给代码（Intl / 时区库）：工具里统一用带时区的 ISO 时间，把每个人的当地时间算好再给模型`,
        `${p.name} (${p.office}, ${p.timezone}) works ${p.workingDays} ${p.workingHours.start}–${p.workingHours.end} local time, but for them this meeting is at ${describeLocal(s, p.timezone, t)}. ${dstHint(p.timezone, s)}Leave time zone conversion to code (Intl / a tz library): use zoned ISO times in your tools and work out everyone's local time before showing it to the model`,
      )
    }
  }
  for (const o of all) {
    if (o.id === ev.id || o.status !== 'confirmed') continue
    if (!(Date.parse(o.start) < t && s < Date.parse(o.end))) continue
    const common = o.attendees.filter((x) => ev.attendees.includes(x))
    if (common.length)
      return L(
        `和 ${names(common)} 已有的会议“${o.title}”（北京时间 ${bj(Date.parse(o.start), Date.parse(o.end))}）冲突。找时间之前要查所有参会人的忙闲`,
        `Clashes with "${o.title}" that ${names(common)} already has (Beijing time ${bj(Date.parse(o.start), Date.parse(o.end))}). Check every attendee's availability before picking a time`,
      )
    if (ev.room && o.room === ev.room)
      return L(
        `会议室 ${nameOf(ev.room)} 在这个时间已经被“${o.title}”占用（北京时间 ${bj(Date.parse(o.start), Date.parse(o.end))}）。会议室也要查忙闲`,
        `Room ${nameOf(ev.room)} is already taken by "${o.title}" at that time (Beijing time ${bj(Date.parse(o.start), Date.parse(o.end))}). Check the room's availability too`,
      )
  }
  return null
}

function createError(exp: CreateExpect, ev: CalEvent, all: CalEvent[]): string | null {
  const s = Date.parse(ev.start)
  const t = Date.parse(ev.end)
  if ((t - s) / 60_000 !== exp.minutes) return L(`时长应为 ${exp.minutes} 分钟，实际是 ${(t - s) / 60_000} 分钟`, `Duration should be ${exp.minutes} minutes, but it is ${(t - s) / 60_000}`)
  if (!exp.windows.some(([a, b]) => Date.parse(a) <= s && t <= Date.parse(b))) {
    const H8 = 8 * 3_600_000
    // 把北京时间的“裸时间”传给 API，会被当成 UTC：实际时间比本意晚 8 小时
    const off8 = exp.windows.some(([a, b]) => Date.parse(a) <= s - H8 && t - H8 <= Date.parse(b))
    const hint = off8
      ? L(
          '时间正好差了 8 小时：很可能把北京时间当成 UTC 传给了 createEvent。传给 API 的时间一定要带时区（例如 2026-10-22T08:30:00Z 或 +08:00）',
          'Off by exactly 8 hours: Beijing time was most likely passed to createEvent as UTC. Times sent to the API must carry a time zone (e.g. 2026-10-22T08:30:00Z or +08:00)',
        )
      : localOf(s, 'Asia/Shanghai').date.startsWith('2026-10') || localOf(s, 'Asia/Shanghai').date.startsWith('2026-11')
        ? L('检查日期和请求人的要求（上午 / 下午、不开会的时间、请求人选择的时间……）', "Check the date and the requester's constraints (morning / afternoon, times they don't take meetings, the time they picked…)")
        : L('日期完全不对：模型不知道今天是哪天。把 env.now()（以及星期几）写进 system prompt', "The date is way off: the model doesn't know what day it is. Put env.now() (and the weekday) in the system prompt")
    return L(`时间不对：应该在${exp.when}，实际是北京时间 ${bj(s, t)}。${hint}`, `Wrong time: should be ${exp.when}, but it's ${bj(s, t)} Beijing time. ${hint}`)
  }
  const want = [...exp.attendees].sort()
  const got = [...ev.attendees].sort()
  if (want.join() !== got.join()) {
    const missing = want.filter((x) => !got.includes(x))
    const extra = got.filter((x) => !want.includes(x))
    return L(
      `参会人不对：${missing.length ? `少了 ${names(missing)}` : ''}${missing.length && extra.length ? '，' : ''}${extra.length ? `多了 ${names(extra)}` : ''}（应为 ${names(want)}）。${missing.includes(REQUESTER.email) ? '请求人自己也参加时，要把他放进 attendees。' : ''}`,
      `Wrong attendees: ${missing.length ? `missing ${names(missing)}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `extra ${names(extra)}` : ''} (should be ${names(want)}).${missing.includes(REQUESTER.email) ? ' When the requester attends, put them in attendees too.' : ''}`,
    )
  }
  if (exp.room) {
    const r = ROOMS.find((x) => x.id === ev.room)
    if (!r)
      return L(
        `需要预订会议室（${exp.room.office}，至少 ${exp.room.minCapacity} 人${exp.room.equipment ? `，有${exp.room.equipment}` : ''}），但会议没有会议室。先用 listRooms 找合适的会议室，再通过 room 参数传给 createEvent`,
        `A room is required (${exp.room.office}, at least ${exp.room.minCapacity} people${exp.room.equipment ? `, with ${exp.room.equipment}` : ''}), but the meeting has none. Find a suitable room with listRooms, then pass it to createEvent via the room parameter`,
      )
    if (r.office !== exp.room.office) return L(`会议室 ${r.name} 在${r.office}办公室，应该在${exp.room.office}`, `Room ${r.name} is in the ${r.office} office; it should be in ${exp.room.office}`)
    if (r.capacity < Math.max(exp.room.minCapacity, ev.attendees.length))
      return L(`会议室 ${r.name} 只能坐 ${r.capacity} 人，要求至少 ${exp.room.minCapacity} 人`, `Room ${r.name} only seats ${r.capacity}; at least ${exp.room.minCapacity} required`)
    if (exp.room.equipment && !r.equipment.includes(exp.room.equipment))
      return L(`会议室 ${r.name} 没有${exp.room.equipment}（设备：${r.equipment.join('、')}）`, `Room ${r.name} has no ${exp.room.equipment} (equipment: ${r.equipment.join(', ')})`)
  }
  return constraintError(ev, all)
}

const fmtEv = (ev: CalEvent) =>
  L(
    `“${ev.title}” 北京时间 ${bj(Date.parse(ev.start), Date.parse(ev.end))}，参会人 ${names(ev.attendees)}${ev.room ? `，会议室 ${nameOf(ev.room)}` : ''}`,
    `"${ev.title}" ${bj(Date.parse(ev.start), Date.parse(ev.end))} Beijing time, attendees ${names(ev.attendees)}${ev.room ? `, room ${nameOf(ev.room)}` : ''}`,
  )

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
          reason: L(
          `在请求人做出选择 / 确认之前就执行了写操作（${a.op} ${a.eventId}，请求人最近一句话：“${a.userText.slice(0, 40)}”）。${spec.why}。在 system prompt 里要求“先列出方案、等请求人确认后再执行”，并且问完问题就把这一轮交还给请求人`,
          `A write happened before the requester chose / confirmed (${a.op} ${a.eventId}; the requester's last words: "${a.userText.slice(0, 40)}"). ${spec.why}. Tell the model in the system prompt to "propose first and act only after the requester confirms", and end the turn as soon as it asks a question`,
        ),
        }

  // 不该动的会议
  for (const e of all) {
    const before = initial.get(e.id)
    if (!before || JSON.stringify(before) === JSON.stringify(e)) continue
    if (exp.update?.id === e.id || exp.cancel?.id === e.id) continue
    return {
      pass: false,
      reason: L(
        `改动了不该改动的会议：${fmtEv(before)}${e.status === 'cancelled' ? ' 被取消了' : ` 被改成了 ${fmtEv(e)}`}。${spec.why}`,
        `Changed a meeting that should be left alone: ${fmtEv(before)}${e.status === 'cancelled' ? ' was cancelled' : ` became ${fmtEv(e)}`}. ${spec.why}`,
      ),
    }
  }

  const created = all.filter((e) => !initial.has(e.id) && e.status === 'confirmed')

  if (exp.cancel) {
    const e = all.find((x) => x.id === exp.cancel!.id)!
    if (e.status !== 'cancelled')
      return {
        pass: false,
        reason: L(
          `应该取消 ${fmtEv(initial.get(e.id)!)}，但它还在。${spec.why}。${st.actions.length ? '' : '对话中没有任何取消操作。常见原因：模型不知道今天是哪天（“下周一”算错了）、找不到会议 id、请求人确认后没有继续执行、每一轮没有带上对话历史、工具参数缺失。'}`,
          `${fmtEv(initial.get(e.id)!)} should have been cancelled, but it's still there. ${spec.why}.${st.actions.length ? '' : " Nothing was cancelled during the conversation. Common causes: the model doesn't know today's date (\"next Monday\" is wrong), can't find the meeting id, doesn't continue after the requester confirms, the conversation history isn't carried between turns, or tool arguments are missing."}`,
        ),
      }
    const act = st.actions.find((a) => a.op === 'cancel' && a.eventId === e.id)
    if (exp.cancel.notify && !act?.notify)
      return {
        pass: false,
        reason: L(
          '取消会议时要通知参会人（cancelEvent 的 notifyAttendees: true，最好附上说明），请求人明确要求“跟大家说一声”',
          'Notify the attendees when cancelling (cancelEvent with notifyAttendees: true, ideally with a message): the requester explicitly asked to let everyone know',
        ),
      }
  }

  if (exp.update) {
    const u = exp.update
    const e = all.find((x) => x.id === u.id)!
    const before = initial.get(u.id)!
    if (created.length)
      return {
        pass: false,
        reason: L(
          `应该修改原会议（updateEvent ${u.id}），而不是新建：现在日历上多了 ${created.map(fmtEv).join('；')}${JSON.stringify(e) === JSON.stringify(before) ? '，原会议还在原来的时间' : ''}`,
          `Should modify the original meeting (updateEvent ${u.id}), not create a new one: the calendar now has an extra ${created.map(fmtEv).join('; ')}${JSON.stringify(e) === JSON.stringify(before) ? ', and the original is still at its old time' : ''}`,
        ),
      }
    if (e.status !== 'confirmed') return { pass: false, reason: L(`应该修改会议 ${u.id}，但它被取消了`, `Meeting ${u.id} should have been modified, but it was cancelled`) }
    if (Date.parse(e.start) !== Date.parse(u.start) || Date.parse(e.end) !== Date.parse(u.end))
      return {
        pass: false,
        reason: L(
          `会议“${e.title}”的时间应改为北京时间 ${bj(Date.parse(u.start), Date.parse(u.end))}，实际是 ${bj(Date.parse(e.start), Date.parse(e.end))}${
            JSON.stringify(e) === JSON.stringify(before)
              ? '（没有被修改过）。常见原因：模型不知道今天是哪天、找不到会议 id、请求人确认后没有继续执行、每一轮没有带上对话历史'
              : Date.parse(e.start) - Date.parse(u.start) === 8 * 3_600_000
                ? '。时间正好晚了 8 小时：很可能把北京时间当成 UTC 传给了 updateEvent。传给 API 的时间一定要带时区'
                : `。${spec.why}`
          }`,
          `"${e.title}" should move to ${bj(Date.parse(u.start), Date.parse(u.end))} Beijing time, but it's at ${bj(Date.parse(e.start), Date.parse(e.end))}${
            JSON.stringify(e) === JSON.stringify(before)
              ? " (never modified). Common causes: the model doesn't know today's date, can't find the meeting id, doesn't continue after the requester confirms, or the conversation history isn't carried between turns"
              : Date.parse(e.start) - Date.parse(u.start) === 8 * 3_600_000
                ? '. Exactly 8 hours late: Beijing time was most likely passed to updateEvent as UTC. Times sent to the API must carry a time zone'
                : `. ${spec.why}`
          }`,
        ),
      }
    const want = [...(u.attendees ?? before.attendees)].sort().join()
    if ([...e.attendees].sort().join() !== want)
      return { pass: false, reason: L(`会议“${e.title}”的参会人应为 ${names(u.attendees ?? before.attendees)}，实际是 ${names(e.attendees)}`, `"${e.title}" should have attendees ${names(u.attendees ?? before.attendees)}, but has ${names(e.attendees)}`) }
    const bad = constraintError(e, all)
    if (bad) return { pass: false, reason: L(`修改后的会议不合规：${bad}`, `The modified meeting breaks the rules: ${bad}`) }
  }

  if (!exp.creates.length && created.length)
    return { pass: false, reason: L(`这个请求不应该新建会议（${spec.why}），却订了 ${created.map(fmtEv).join('；')}`, `This request shouldn't create a meeting (${spec.why}), but it booked ${created.map(fmtEv).join('; ')}`) }
  if (exp.creates.length) {
    if (!created.length)
      return {
        pass: false,
        reason: L(
          `没有预订会议：期望 ${exp.creates.length} 个（${exp.creates.map((c) => `${names(c.attendees)}，${c.minutes} 分钟，${c.when}`).join('；')}）。常见原因：模型不知道今天是哪天（日期算错，查不到空闲时间）；请求人确认后没有继续执行；每一轮没有带上之前的对话历史；找不到参会人的邮箱。`,
          `No meeting booked: expected ${exp.creates.length} (${exp.creates.map((c) => `${names(c.attendees)}, ${c.minutes} min, ${c.when}`).join('; ')}). Common causes: the model doesn't know today's date (wrong dates, so no free time found); it doesn't continue after the requester confirms; the conversation history isn't carried between turns; it can't find the attendees' emails.`,
        ),
      }
    if (created.length !== exp.creates.length)
      return { pass: false, reason: L(`应该新建 ${exp.creates.length} 个会议，实际新建了 ${created.length} 个：${created.map(fmtEv).join('；')}`, `Should create ${exp.creates.length} meetings, but created ${created.length}: ${created.map(fmtEv).join('; ')}`) }
    const used = new Set<string>()
    for (const c of exp.creates) {
      const errs = created.filter((e) => !used.has(e.id)).map((e) => [e, createError(c, e, all)] as const)
      const hit = errs.find(([, err]) => !err)
      if (!hit) return { pass: false, reason: `${fmtEv(errs[0][0])}${L('：', ': ')}${errs[0][1]}` }
      used.add(hit[0].id)
    }
  }

  if (exp.mustSay) {
    const said = st.user.transcript.filter((m) => m.role === 'agent').map((m) => m.text).join('\n')
    if (!exp.mustSay.re.test(said)) return { pass: false, reason: L(`没有向请求人${exp.mustSay.what}。${spec.why}`, `Didn't ${exp.mustSay.what} to the requester. ${spec.why}`) }
  }

  const done = [
    exp.creates.length ? L(`新建 ${exp.creates.length} 个会议`, `created ${exp.creates.length} meeting(s)`) : '',
    exp.update ? L('修改原会议', 'modified the original meeting') : '',
    exp.cancel ? L('取消会议', 'cancelled the meeting') : '',
  ]
    .filter(Boolean)
    .join(L('、', ', '))
  return { pass: true, reason: done ? L(`完成：${done}，所有约束都满足`, `Done: ${done}; all constraints met`) : L('没有违规预订，正确说明了情况', 'No rule-breaking booking; explained the situation correctly') }
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

