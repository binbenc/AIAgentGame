/**
 * P4 的模拟模型：一个“会用工具、但只相信它看到的东西”的日程助手。
 *
 * - 它听得懂请求人要什么（目标按任务 id 取），前提是请求人的原话真的出现在请求里（对话历史没丢）。
 * - 日期：只有请求里出现了“今天”的日期，它才能算对“明天 / 下周一”；否则它按训练数据里的某一天去算（日期全错）。
 * - 请求人是谁：只有请求里出现了请求人的邮箱，它才会把请求人放进参会人。
 * - 找时间（三档）：
 *   1. 有“算好的共同空闲时段”工具（slot / 共同空闲）：直接从结果里挑，原样抄结果里的时间字符串；
 *   2. 只有原始忙闲查询：它自己换算时区——用的是**今天**的 UTC 偏移（伦敦 +1、旧金山 -7），跨过夏令时切换就算错；
 *   3. 什么都没有：凭感觉挑一个“常见时间”。
 * - 写时间：抄来的字符串原样传；自己算出来的时间，只有工具说明里要求带时区 / UTC，它才写成 UTC，否则写成请求人当地时间的
 *   “裸时间”（不带时区）——日历 API 会把它当成 UTC，差 8 小时。
 * - 规范：system 里有“确认后再执行”，它才会先列方案等确认、冲突时给选项；有“工作时间”的要求，找不到时间时才会解释而不是硬订。
 * - 改期：有修改工具才会改原会议；只有新建工具时，它会新建一个（日历上出现重复）。
 */
import { L } from '../../engine/locale'
import { callTool, say } from '../../engine/llm/mock-kit'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type ToolSpec } from '../../engine/llm/types'
import { EQUIP, OFFICES, PEOPLE, REQUESTER } from './env/data'
import { describeLocal, hhmm, isoZ, localOf, toMin } from './env/tz'
import { isConfirmOrChoice } from './tasks'

interface Goal {
  kind: 'book' | 'reschedule' | 'cancel'
  /** 请求人原话里的一段：用来判断请求是否还在上下文里 */
  key: string
  names?: string[]
  withMe?: boolean
  minutes?: number
  title: string
  /** 相对“今天”的天数 */
  days?: number[]
  part?: 'am' | 'pm'
  /** 请求人指定的当地时间 */
  at?: string
  room?: { office: string; min: number; equip: string }
  /** 请求人说过的限制：只有这句话还在上下文里，模型才会遵守 */
  avoid?: { phrase: string; weekday: number; fromMin: number }
  /** 改期 / 取消的对象 */
  event?: { match: string; day: number }
  moveTo?: number
  message?: string
}

const GOALS: Record<string, Goal> = L<Record<string, Goal>>(
  {
    'three-zones': { kind: 'book', key: '海外版本', names: ['王磊', 'Oliver'], withMe: true, minutes: 30, title: '海外版本发布计划', days: [1] },
    reschedule: { kind: 'reschedule', key: 'Emma 的 1:1', title: '1:1', event: { match: 'Emma', day: 1 }, moveTo: 2 },
    'room-projector': { kind: 'book', key: '美术评审', names: ['刘倩', '张浩'], withMe: true, minutes: 60, title: '美术评审', days: [1], part: 'pm', room: { office: OFFICES.bj, min: 8, equip: EQUIP.projector } },
    'no-friday-pm': { kind: 'book', key: '同步一下进度', names: ['刘倩', '张浩'], withMe: true, minutes: 60, title: '进度同步', days: [2, 5], avoid: { phrase: '周五下午', weekday: 5, fromMin: 12 * 60 } },
    'conflict-choose': { kind: 'book', key: '引擎升级', names: ['王磊'], withMe: true, minutes: 30, title: '引擎升级沟通', days: [1], at: '10:00' },
    'cancel-notify': { kind: 'cancel', key: '项目周会取消', title: '项目周会', event: { match: '项目周会', day: 5 }, message: '本次项目周会取消，改期另行通知。' },
    'dst-next-week': { kind: 'book', key: '和 Oliver 约 30 分钟', names: ['Oliver'], withMe: true, minutes: 30, title: '与 Oliver 沟通', days: [5], part: 'pm' },
    impossible: { kind: 'book', key: 'Sarah、Oliver', names: ['Sarah', 'Oliver'], withMe: true, minutes: 60, title: '三方会议', days: [1] },
  },
  {
    'three-zones': { kind: 'book', key: 'overseas launch', names: ['Wang Lei', 'Oliver'], withMe: true, minutes: 30, title: 'Overseas launch plan', days: [1] },
    reschedule: { kind: 'reschedule', key: '1:1 with Emma', title: '1:1', event: { match: 'Emma', day: 1 }, moveTo: 2 },
    'room-projector': { kind: 'book', key: 'art review', names: ['Liu Qian', 'Zhang Hao'], withMe: true, minutes: 60, title: 'Art review', days: [1], part: 'pm', room: { office: OFFICES.bj, min: 8, equip: EQUIP.projector } },
    'no-friday-pm': { kind: 'book', key: 'progress sync', names: ['Liu Qian', 'Zhang Hao'], withMe: true, minutes: 60, title: 'Progress sync', days: [2, 5], avoid: { phrase: 'Friday afternoons', weekday: 5, fromMin: 12 * 60 } },
    'conflict-choose': { kind: 'book', key: 'engine upgrade', names: ['Wang Lei'], withMe: true, minutes: 30, title: 'Engine upgrade chat', days: [1], at: '10:00' },
    'cancel-notify': {
      kind: 'cancel',
      key: "Cancel next Monday's weekly project sync",
      title: 'Weekly project sync',
      event: { match: 'Weekly project sync', day: 5 },
      message: "This week's project sync is cancelled; we'll share a new time later.",
    },
    'dst-next-week': { kind: 'book', key: '30 minutes with Oliver', names: ['Oliver'], withMe: true, minutes: 30, title: 'Chat with Oliver', days: [5], part: 'pm' },
    impossible: { kind: 'book', key: 'Sarah and Oliver', names: ['Sarah', 'Oliver'], withMe: true, minutes: 60, title: 'Three-way meeting', days: [1] },
  },
)

const TODAY = '2026-10-21'
/** 不知道今天是哪天时，模型“以为”的日期 */
const GUESS_TODAY = '2025-06-10'
/** 模型脑子里的时差：按“今天”（10 月 21 日）的情况 */
const BELIEVED_OFFSET: Record<string, number> = { 'Asia/Shanghai': 480, 'Europe/London': 60, 'America/Los_Angeles': -420 }
const BJ = 'Asia/Shanghai'

type ToolKind = 'people' | 'slots' | 'avail' | 'rooms' | 'events' | 'cancel' | 'update' | 'create'
const KINDS: [ToolKind, RegExp][] = [
  ['people', /people|person|directory|colleague|employee|member|同事|人员|员工|通讯录/i],
  ['slots', /slot|find_?time|common|suggest|共同|空闲时段/i],
  ['avail', /availab|busy|free|忙闲|空闲/i],
  ['rooms', /room|会议室/i],
  ['events', /(list|find|search|get|query)_?(my_?)?(events|meetings|calendar)|查找会议|查询会议|日程列表/i],
  ['cancel', /cancel|delete|remove|取消/i],
  ['update', /update|reschedule|move|modify|edit|改期|修改/i],
  ['create', /create|book|schedule|add_?event|新建|预订|预定|创建/i],
]

function kindOf(t: ToolSpec): ToolKind | undefined {
  for (const [k, re] of KINDS) if (re.test(t.name)) return k
  for (const [k, re] of KINDS) if (re.test(t.description)) return k
  return undefined
}

type Style = 'Z' | 'naive'
/** 工具说明里有没有要求带时区 */
const styleOf = (t: ToolSpec): Style => (/UTC|时区|offset|Z 结尾|以 ?Z|\+08:00|带时区|time ?zone|ending in Z/i.test(`${t.description} ${JSON.stringify(t.input_schema)}`) ? 'Z' : 'naive')
/** 一个时间字符串的写法 */
const styleOfString = (s: string): Style => (/(Z|[+-]\d{2}:?\d{2})$/i.test(s.trim()) ? 'Z' : 'naive')

function fmt(ms: number, style: Style): string {
  if (style === 'Z') return isoZ(ms)
  const l = localOf(ms, BJ)
  return `${l.date}T${hhmm(l.min)}:00`
}
/** 模型读时间：带时区的照读；不带时区的，它以为是请求人当地时间 */
function readTime(s: string): number {
  const t = s.trim().replace(' ', 'T')
  return styleOfString(t) === 'Z' ? Date.parse(t) : Date.parse(`${t}+08:00`)
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const bjAt = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+08:00`)

function fill(t: ToolSpec, v: Record<string, unknown>): Record<string, unknown> {
  const props = t.input_schema.properties ?? {}
  const rules: [RegExp, string][] = [
    [/event_?id|^id$/i, 'eventId'],
    [/notify|send_?updates/i, 'notify'],
    [/capacity|size|seats/i, 'capacity'],
    [/duration|minutes|length/i, 'minutes'],
    [/attendee|participant|emails?$|invitee|people/i, 'attendees'],
    [/room/i, 'room'],
    [/start|^from$|begin|time_?min/i, 'start'],
    [/end|^to$|until|time_?max/i, 'end'],
    [/title|summary|subject|topic/i, 'title'],
    [/message|note|reason|comment/i, 'message'],
    [/office|location|city|site/i, 'office'],
    [/equip|feature|facilit/i, 'equipment'],
    [/query|name|keyword|^q$|search/i, 'query'],
  ]
  const out: Record<string, unknown> = {}
  for (const [p, schema] of Object.entries(props)) {
    const hit = rules.find(([re]) => re.test(p))
    if (!hit || v[hit[1]] === undefined) continue
    const val = v[hit[1]]
    out[p] = schema.type === 'array' && !Array.isArray(val) ? [val] : schema.type === 'string' && Array.isArray(val) ? val.join(',') : val
  }
  return out
}

interface Call {
  name: string
  input: any
  ok: boolean
  out: string
}
type Ev = { kind: 'user' | 'agent'; text: string } | ({ kind: 'call' } & Call)

function timeline(req: ChatRequest): Ev[] {
  const results = new Map<string, { content: string; is_error?: boolean }>()
  for (const m of req.messages) for (const b of blocksOf(m.content)) if (b.type === 'tool_result') results.set(b.tool_use_id, b)
  const ev: Ev[] = []
  for (const m of req.messages) {
    const bl = blocksOf(m.content)
    const text = bl.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    if (text) ev.push({ kind: m.role === 'user' ? 'user' : 'agent', text })
    if (m.role === 'assistant')
      for (const b of bl)
        if (b.type === 'tool_use') {
          const r = results.get(b.id)
          ev.push({ kind: 'call', name: b.name, input: b.input, ok: !!r && !r.is_error && !/^\s*(错误|error\b)/i.test(r.content), out: r?.content ?? '' })
        }
  }
  return ev
}

/** 把一段文本里的 JSON 拆成对象（递归），模型“读得懂”工具返回的结构化数据 */
function objects(text: string): Record<string, any>[] {
  const out: Record<string, any>[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      out.push(v as Record<string, any>)
      Object.values(v).forEach(walk)
    }
  }
  try {
    walk(JSON.parse(text))
  } catch {
    /* 不是 JSON */
  }
  return out
}

interface Slot {
  s: number
  e: number
  /** 从工具结果里抄来的原始字符串 */
  raw?: { start: string; end: string }
  room?: string
}

export const mock: MockModel = (req, ctx) => {
  const goal = GOALS[ctx.scenario.split('#')[0]]
  if (!goal) return say(L('（模拟模型只会做核心任务；完整任务集请用真实模型跑基准）', '(The mock model only handles core tasks; run the full set as a benchmark on a real model.)'))
  return new Session(goal, req, ctx).next()
}

class Session {
  private ev: Ev[]
  private calls: (Ev & { kind: 'call' })[]
  private users: string[]
  private text: string
  private tools: Partial<Record<ToolKind, ToolSpec>> = {}
  private sys: string

  constructor(
    private g: Goal,
    req: ChatRequest,
    private ctx: MockContext,
  ) {
    this.ev = timeline(req)
    this.calls = this.ev.filter((e): e is Ev & { kind: 'call' } => e.kind === 'call')
    this.users = this.ev.flatMap((e) => (e.kind === 'user' ? [e.text] : []))
    this.sys = req.system ?? ''
    this.text = [this.sys, ...this.ev.map((e) => (e.kind === 'call' ? `${JSON.stringify(e.input)}\n${e.out}` : e.text))].join('\n')
    for (const t of req.tools ?? []) {
      const k = kindOf(t)
      if (k && !this.tools[k]) this.tools[k] = t
    }
  }

  // —— 模型知道什么 ——
  private get today() {
    return /2026-10-21|10\s*月\s*21\s*日|Oct(ober)?\.?\s*21\b/i.test(this.text) ? TODAY : GUESS_TODAY
  }
  private get confirmRule() {
    return /(明确|得到|获得|等待|等).{0,8}确认|确认.{0,10}(之后|以后|后再|后才|才能|再执行)|confirm.{0,20}before|(after|until|once|wait for|ask for|get)\b.{0,30}\b(confirm|approv)|explicit(ly)? confirm/i.test(this.sys)
  }
  private get workRule() {
    return /工作时间|working hours/i.test(this.sys)
  }
  private get me() {
    return this.text.includes(REQUESTER.email) ? REQUESTER.email : undefined
  }
  private called = (k: ToolKind) => !!this.tools[k] && this.calls.some((c) => c.name === this.tools[k]!.name)
  private callsOf = (k: ToolKind) => (this.tools[k] ? this.calls.filter((c) => c.name === this.tools[k]!.name) : [])
  private lastUser = () => this.users[this.users.length - 1] ?? ''

  next() {
    if (!this.users.some((u) => u.includes(this.g.key))) return say(L('您好！请问需要我帮您安排什么会议？', 'Hi! What meeting can I set up for you?'))
    const last = this.ev[this.ev.length - 1]
    const writes = new Set(['create', 'update', 'cancel'].map((k) => this.tools[k as ToolKind]?.name).filter(Boolean))
    if (last?.kind === 'call' && writes.has(last.name)) return last.ok ? say(this.doneText(last)) : say(L(`抱歉，操作没有成功：${last.out.replace(/^错误：/, '')}`, `Sorry, that didn't work: ${last.out.replace(/^错误：|^Error:\s*/, '')}`))
    if (this.calls.some((c) => writes.has(c.name) && c.ok)) return say(L('还有其他需要帮忙的吗？', 'Anything else I can help with?'))
    if (last?.kind === 'call' && !last.ok) return say(L(`抱歉，查询时出错了：${last.out.replace(/^错误：/, '')}`, `Sorry, the lookup failed: ${last.out.replace(/^错误：|^Error:\s*/, '')}`))
    if (this.g.kind === 'book') return this.book()
    return this.existing()
  }

  // —————————— 人和会议室 ——————————

  private visiblePeople(): Record<string, any>[] {
    return this.calls.flatMap((c) => objects(c.out)).filter((o) => typeof o.email === 'string' && typeof o.name === 'string')
  }
  private person(name: string) {
    return this.visiblePeople().find((o) => String(o.name).includes(name))
  }

  /** 找参会人的邮箱：返回需要调用的工具，或者邮箱列表 */
  private resolvePeople(): { call?: ReturnType<typeof callTool>; emails?: string[] } {
    const emails: string[] = []
    for (const n of this.g.names ?? []) {
      const p = this.person(n)
      if (p) {
        emails.push(String(p.email))
        continue
      }
      const t = this.tools.people
      if (t) {
        const hasQuery = Object.keys(t.input_schema.properties ?? {}).some((k) => /query|name|keyword|^q$|search/i.test(k))
        const asked = this.callsOf('people').some((c) => !hasQuery || JSON.stringify(c.input).includes(n))
        if (!asked) return { call: callTool(this.ctx, t.name, hasQuery ? fill(t, { query: n }) : {}) }
      }
      emails.push(`${n.toLowerCase()}@prismgames.com`) // 猜一个邮箱
    }
    const me = this.g.withMe && this.me ? [this.me] : []
    return { emails: [...me, ...emails] }
  }

  private roomCandidates(): { call?: ReturnType<typeof callTool>; rooms: string[] } {
    const r = this.g.room
    if (!r) return { rooms: [] }
    const seen = this.calls.flatMap((c) => objects(c.out)).filter((o) => typeof o.capacity === 'number' && typeof o.id === 'string')
    if (!seen.length) {
      const t = this.tools.rooms
      if (t && !this.called('rooms')) return { call: callTool(this.ctx, t.name, fill(t, { office: r.office, capacity: r.min, equipment: r.equip })), rooms: [] }
      return { rooms: [] }
    }
    const ok = seen
      .filter((o) => (!o.office || o.office === r.office) && o.capacity >= r.min && Array.isArray(o.equipment) && o.equipment.includes(r.equip))
      .sort((a, b) => a.capacity - b.capacity)
    return { rooms: [...new Set(ok.map((o) => String(o.id)))] }
  }

  // —————————— 找时间 ——————————

  private dates() {
    return (this.g.days ?? []).map((d) => addDays(this.today, d))
  }
  private range(): [number, number] {
    const ds = this.dates()
    const from = this.g.part === 'pm' ? '12:00' : '00:00'
    const to = this.g.part === 'am' ? '12:00' : '24:00'
    return [bjAt(ds[0], from), bjAt(ds[ds.length - 1], '00:00') + toMin(to) * 60_000]
  }

  /** 请求人的偏好 / 指定时间：只按上下文里看得见的话来 */
  private acceptable(s: number, at?: string): boolean {
    const l = localOf(s, BJ)
    if (!this.dates().includes(l.date)) return false
    if (this.g.part === 'am' && l.min >= 12 * 60) return false
    if (this.g.part === 'pm' && l.min < 12 * 60) return false
    const av = this.g.avoid
    if (av && this.users.some((u) => u.includes(av.phrase)) && l.weekday === av.weekday && l.min >= av.fromMin) return false
    if (at && hhmm(l.min) !== at) return false
    return true
  }

  /** 第 1 档：玩家给了“算好的共同空闲时段”工具 */
  private slotsFromTool(attendees: string[], room?: string): { call?: ReturnType<typeof callTool>; slots?: Slot[] } {
    const t = this.tools.slots!
    const minutes = this.g.minutes!
    const mine = this.callsOf('slots').filter((c) => (room ? JSON.stringify(c.input).includes(room) : !/room-/.test(JSON.stringify(c.input))))
    if (!mine.length) {
      const [a, b] = this.range()
      const style = styleOf(t)
      const roomKey = Object.keys(t.input_schema.properties ?? {}).some((k) => /room/i.test(k))
      const v: Record<string, unknown> = { attendees: room && !roomKey ? [...attendees, room] : attendees, minutes, start: fmt(a, style), end: fmt(b, style), room }
      return { call: callTool(this.ctx, t.name, fill(t, v)) }
    }
    const out = mine[mine.length - 1].out
    const slots = objects(out)
      .filter((o) => typeof o.start === 'string' && typeof o.end === 'string')
      .map((o) => ({ s: readTime(o.start), e: readTime(o.end), raw: { start: o.start, end: o.end }, room }))
      .filter((x) => !Number.isNaN(x.s))
    return { slots }
  }

  /** 第 2 档：只有原始忙闲，模型自己换算时区（用的是“今天”的时差） */
  private slotsByHand(attendees: string[], rooms: string[]): { call?: ReturnType<typeof callTool>; slots?: Slot[] } {
    const t = this.tools.avail!
    const [a, b] = this.range()
    if (!this.called('avail')) {
      const style = styleOf(t)
      return { call: callTool(this.ctx, t.name, fill(t, { attendees: [...attendees, ...rooms], start: fmt(a, style), end: fmt(b, style) })) }
    }
    const busy = new Map<string, [number, number][]>()
    for (const o of this.callsOf('avail').flatMap((c) => objects(c.out)))
      if (typeof o.email === 'string' && Array.isArray(o.busy)) busy.set(o.email, o.busy.map((x: any) => [readTime(String(x.start)), readTime(String(x.end))] as [number, number]))
    const free = (id: string, s: number, e: number) => !(busy.get(id) ?? []).some(([x, y]) => x < e && s < y)
    const hours = (id: string) => {
      const p = this.visiblePeople().find((o) => o.email === id)
      const tz = typeof p?.timezone === 'string' ? p.timezone : BJ
      const wh = p?.workingHours
      return { off: BELIEVED_OFFSET[tz] ?? 480, from: toMin(wh?.start ?? '09:00'), to: toMin(wh?.end ?? '18:00') }
    }
    const inHours = (id: string, s: number, e: number) => {
      const h = hours(id)
      const ls = new Date(s + h.off * 60_000)
      const le = new Date(e - 1 + h.off * 60_000)
      const m1 = ls.getUTCHours() * 60 + ls.getUTCMinutes()
      const m2 = le.getUTCHours() * 60 + le.getUTCMinutes() + 1
      return ls.getUTCDate() === le.getUTCDate() && ls.getUTCDay() >= 1 && ls.getUTCDay() <= 5 && m1 >= h.from && m2 <= h.to
    }
    const slots: Slot[] = []
    const step = 30 * 60_000
    const dur = this.g.minutes! * 60_000
    for (let s = a; s + dur <= b; s += step) {
      const e = s + dur
      if (!attendees.every((x) => inHours(x, s, e) && free(x, s, e))) continue
      const room = rooms.find((r) => free(r, s, e))
      if (rooms.length && !room) continue
      slots.push({ s, e, room })
    }
    return { slots }
  }

  private book() {
    const ppl = this.resolvePeople()
    if (ppl.call) return ppl.call
    const attendees = ppl.emails!
    const rc = this.roomCandidates()
    if (rc.call) return rc.call
    const minutes = this.g.minutes!
    const userAt = this.users.length > 1 ? this.lastUser().match(/(\d{1,2})\s*[:：点]\s*(\d{2})?/) : null
    const at = userAt ? `${userAt[1].padStart(2, '0')}:${userAt[2] ?? '00'}` : this.g.at

    // —— 找候选时间 ——
    let slots: Slot[] = []
    if (this.tools.slots) {
      for (const room of rc.rooms.length ? rc.rooms : [undefined]) {
        const r = this.slotsFromTool(attendees, room)
        if (r.call) return r.call
        slots = r.slots!.filter((x) => this.acceptable(x.s))
        if (slots.length) break
      }
    } else if (this.tools.avail) {
      const r = this.slotsByHand(attendees, rc.rooms)
      if (r.call) return r.call
      slots = r.slots!.filter((x) => this.acceptable(x.s))
    } else {
      // 第 3 档：没有任何忙闲信息，凭感觉挑一个“常见时间”
      const d = this.dates()[0]
      const s = bjAt(d, at ?? (this.g.part === 'pm' ? '14:00' : '10:00'))
      slots = [{ s, e: s + minutes * 60_000, room: rc.rooms[0] }]
    }

    let chosen = slots.find((x) => this.acceptable(x.s, at))
    if (!chosen && at && slots.length) {
      // 指定的时间不行：懂规范的模型给选项让请求人选；不懂的直接订最近的
      const alts = slots.slice(0, 2)
      if (this.confirmRule)
        return say(
          L(
            `北京时间 ${at} 有参会人已有安排，这个时间订不了。可选：${alts.map((x, i) => `${i + 1}）${describeLocal(x.s, BJ, x.e)}`).join('；')}。您选哪个？`,
            `Someone already has a meeting at ${at} Beijing time, so I can't book that. Options: ${alts.map((x, i) => `${i + 1}) ${describeLocal(x.s, BJ, x.e)}`).join('; ')}. Which one works for you?`,
          ),
        )
      chosen = alts[0]
    }
    if (!chosen) {
      if (this.workRule)
        return say(
          L(
            `抱歉，在您要求的时间里找不到所有参会人都在工作时间内、又都有空的共同时段（${(this.g.names ?? []).join('、')} 和您分处不同时区，工作时间没有交集）。建议：分成两场分别和他们开，或者请其中一方提前 / 推迟上班。需要我分别帮您约吗？`,
            `Sorry, I couldn't find a slot in your window where every attendee is within working hours and free (${(this.g.names ?? []).join(', ')} and you are in different time zones and your working hours don't overlap). Suggestion: hold two separate meetings, or ask one side to start early / stay late. Want me to set them up separately?`,
          ),
        )
      // 不知道“工作时间”这条规矩：硬订一个“最接近”的时间
      const s = bjAt(this.dates()[0], '09:00')
      chosen = { s, e: s + minutes * 60_000 }
    }

    if (this.confirmRule && !this.confirmed())
      return say(
        L(
          `我查了大家的日程，建议：${this.g.title}，北京时间 ${describeLocal(chosen.s, BJ, chosen.e)}，${minutes} 分钟，参会人：${attendees.join('、')}${chosen.room ? `，会议室 ${chosen.room}` : ''}。确认的话我就预订，可以吗？`,
          `I checked everyone's calendar. Proposal: ${this.g.title}, ${describeLocal(chosen.s, BJ, chosen.e)} Beijing time, ${minutes} minutes, attendees: ${attendees.join(', ')}${chosen.room ? `, room ${chosen.room}` : ''}. Shall I book it? Please confirm.`,
        ),
      )

    const t = this.tools.create
    if (!t) return say(L('抱歉，我没有预订会议的权限。', "Sorry, I don't have permission to book meetings."))
    // 从工具结果里挑的时间：原样抄字符串；自己算的时间：按工具说明的要求写
    const dur = minutes * 60_000
    const style = chosen.raw ? styleOfString(chosen.raw.start) : styleOf(t)
    const start = chosen.raw ? chosen.raw.start : fmt(chosen.s, style)
    const end = chosen.raw && readTime(chosen.raw.end) - chosen.s === dur ? chosen.raw.end : fmt(chosen.s + dur, style)
    return callTool(this.ctx, t.name, fill(t, { title: this.g.title, start, end, attendees, room: chosen.room }))
  }

  /** 请求人刚刚确认了（或者做出了选择） */
  private confirmed(): boolean {
    const lastAgent = [...this.ev].reverse().find((e) => e.kind === 'agent')
    return this.users.length > 1 && isConfirmOrChoice(this.lastUser()) && !!lastAgent && /确认|选|confirm|which|choose|pick|option/i.test((lastAgent as { text: string }).text)
  }

  // —————————— 改期 / 取消已有会议 ——————————

  private existing() {
    const t = this.tools.events
    if (!t) return say(L('抱歉，我查不到您的日程，没法找到这个会议。', "Sorry, I can't see your calendar, so I can't find that meeting."))
    const day = addDays(this.today, this.g.event!.day)
    if (!this.called('events')) {
      const style = styleOf(t)
      return callTool(this.ctx, t.name, fill(t, { start: fmt(bjAt(day, '00:00'), style), end: fmt(bjAt(day, '00:00') + 86_400_000, style) }))
    }
    const m = this.g.event!.match
    const emma = PEOPLE.find((p) => p.name.startsWith(m))?.email
    const ev = this.callsOf('events')
      .flatMap((c) => objects(c.out))
      .find((o) => typeof o.id === 'string' && typeof o.start === 'string' && (String(o.title).includes(m) || (emma && JSON.stringify(o.attendees ?? '').includes(emma))) && localOf(readTime(o.start), BJ).date === day)
    if (!ev) return say(L(`抱歉，我在 ${day} 没有找到“${m}”相关的会议。`, `Sorry, I couldn't find a meeting matching "${m}" on ${day}.`))
    const s = readTime(ev.start)
    const e = readTime(ev.end)

    if (this.g.kind === 'cancel') {
      if (this.confirmRule && !this.confirmed())
        return say(L(`找到了：“${ev.title}”，北京时间 ${describeLocal(s, BJ, e)}。确认取消，并通知参会人吗？`, `Found it: "${ev.title}", ${describeLocal(s, BJ, e)} Beijing time. Please confirm: cancel it and notify the attendees?`))
      const c = this.tools.cancel
      if (!c) return say(L('抱歉，我没有取消会议的权限。', "Sorry, I don't have permission to cancel meetings."))
      return callTool(this.ctx, c.name, fill(c, { eventId: ev.id, notify: true, message: this.g.message }))
    }

    const shift = (this.g.moveTo! - this.g.event!.day) * 86_400_000
    const style = styleOfString(String(ev.start))
    const ns = fmt(s + shift, style)
    const ne = fmt(e + shift, style)
    if (this.confirmRule && !this.confirmed())
      return say(
        L(
          `好的：把“${ev.title}”从北京时间 ${describeLocal(s, BJ, e)} 改到 ${describeLocal(s + shift, BJ, e + shift)}。确认的话我就改，可以吗？`,
          `OK: move "${ev.title}" from ${describeLocal(s, BJ, e)} to ${describeLocal(s + shift, BJ, e + shift)} Beijing time. Shall I go ahead? Please confirm.`,
        ),
      )
    const u = this.tools.update
    if (u) return callTool(this.ctx, u.name, fill(u, { eventId: ev.id, start: ns, end: ne }))
    const c = this.tools.create
    if (!c) return say(L('抱歉，我没有修改会议的权限。', "Sorry, I don't have permission to change meetings."))
    // 没有修改工具：模型只好新建一个（原会议还在）
    return callTool(this.ctx, c.name, fill(c, { title: ev.title, start: ns, end: ne, attendees: (ev.attendees ?? []).map((a: string) => PEOPLE.find((p) => p.name === a)?.email ?? a) }))
  }

  private doneText(c: Call): string {
    const i = c.input ?? {}
    const pick = (re: RegExp) => Object.entries(i).find(([k]) => re.test(k))?.[1] as string | undefined
    const start = pick(/start/)
    const end = pick(/end/)
    const when = start && end ? L(`北京时间 ${describeLocal(readTime(start), BJ, readTime(end))}`, `${describeLocal(readTime(start), BJ, readTime(end))} Beijing time`) : ''
    if (c.name === this.tools.cancel?.name)
      return L(`已为您取消“${this.g.title}”${pick(/notify/) ? '，并通知了参会人' : ''}。`, `Done — I've cancelled "${this.g.title}"${pick(/notify/) ? ' and notified the attendees' : ''}.`)
    if (c.name === this.tools.update?.name) return L(`已为您改期：${when}。`, `Done — I've rescheduled it to ${when}.`)
    return L(`已为您预订：${this.g.title}，${when}。`, `Done — I've booked ${this.g.title}, ${when}.`)
  }
}
