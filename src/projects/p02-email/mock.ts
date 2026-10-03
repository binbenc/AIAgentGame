/**
 * P2 的模拟模型：一个“有能力、但只依据它看到的东西办事”的邮件助手。
 *
 * - 它能读懂邮件（邮件的类型按任务 id 取，相当于模型理解了邮件内容），但前提是邮件正文真的出现在请求里。
 * - 分拣：只有请求里出现了对应的规则（营销 / 自动回复 / 系统通知 / VIP 投诉 / 可疑邮件……），它才按规则分；
 *   否则按“常识”分：newsletter 觉得你可能想看（notify）、noreply 的系统通知觉得不用管（ignore）、
 *   钓鱼邮件说“紧急”，它就当成需要回复。VIP 规则还要求 CRM 里的客户等级真的出现在请求里。
 * - 输出格式：没有工具时，请求要 JSON 就按请求里出现的字段名输出 JSON，否则只输出标签；被要求写回复时输出草稿正文。
 * - 有工具时它是一个 Agent：按名字 / 描述认出工具（查 CRM、查往来邮件、查空闲时间 / 日程、打标签、存草稿、转发、建会），
 *   缺什么信息就调对应的工具；没有工具可调时，草稿里就缺事实，或者编造会议时间（10:00、14:00 这类“常见时间”）。
 * - 草稿里的事实只来自可见的数据：CRM 记录、往来邮件、日历结果。CRM 的内部备注如果可见、而规则里又没有保密要求，它会“好心”地写进草稿。
 */
import { callTool, say } from '../../engine/llm/mock-kit'
import type { MockContext, MockModel } from '../../engine/llm/providers/mock'
import { blocksOf, type ChatRequest, type ToolSpec } from '../../engine/llm/types'
import { CONTACTS, ME, type Contact } from './env/data'
import { freeOf } from './env/index'
import { TASK_SPECS, type Kind, type MailTaskSpec } from './tasks'

type Label = 'ignore' | 'notify' | 'respond'
type ToolKind = 'label' | 'forward' | 'schedule' | 'slots' | 'events' | 'draft' | 'thread' | 'crm'

const KINDS: [ToolKind, RegExp][] = [
  ['label', /label|triage|classif|标签|分拣/i],
  ['forward', /forward|转发/i],
  ['schedule', /schedule|book|create_?(meeting|event)|建会|预约会议/i],
  ['slots', /free|slot|空闲|avail/i],
  ['events', /event|calendar|日程|日历/i],
  ['draft', /draft|草稿|reply|回复/i],
  ['thread', /thread|history|往来|会话|conversation/i],
  ['crm', /crm|contact|客户|联系人|customer/i],
]

function kindOf(t: ToolSpec): ToolKind | undefined {
  for (const [k, re] of KINDS) if (re.test(t.name)) return k
  for (const [k, re] of KINDS) if (re.test(t.description)) return k
  return undefined
}

/** 按玩家工具的参数名填参数 */
function argsFor(t: ToolSpec, v: Record<string, unknown>, primary: unknown): Record<string, unknown> {
  const props = Object.keys(t.input_schema.properties ?? {})
  const out: Record<string, unknown> = {}
  const rules: [RegExp, string][] = [
    [/thread/i, 'threadId'],
    [/(email|message|mail)_?id|^id$/i, 'emailId'],
    [/label|category|tag|分类/i, 'label'],
    [/body|content|text|draft|reply|正文/i, 'body'],
    [/^to$|recipient|收件/i, 'to'],
    [/date|day|日期/i, 'date'],
    [/minute|duration|length/i, 'minutes'],
    [/start/i, 'start'],
    [/end/i, 'end'],
    [/title|subject/i, 'title'],
    [/attendee|invitee|participant/i, 'attendees'],
    [/note|comment|message/i, 'note'],
    [/email|address|addr|sender|from|query|keyword|^q$/i, 'address'],
  ]
  for (const p of props) {
    const hit = rules.find(([re]) => re.test(p))
    if (hit && v[hit[1]] !== undefined) out[p] = v[hit[1]]
  }
  const first = t.input_schema.required?.[0] ?? props[0]
  if (first && out[first] === undefined && primary !== undefined) out[first] = primary
  return out
}

interface Use {
  name: string
  input: any
  result?: string
}

function uses(req: ChatRequest): Use[] {
  const out: Use[] = []
  const byId = new Map<string, Use>()
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'tool_use') {
        const u: Use = { name: b.name, input: b.input }
        out.push(u)
        byId.set(b.id, u)
      } else if (b.type === 'tool_result') {
        const u = byId.get(b.tool_use_id)
        if (u) u.result = b.content
      }
    }
  return out
}

function visible(req: ChatRequest): string {
  const parts = [req.system ?? '']
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'tool_result') parts.push(b.content)
      else if (b.type === 'tool_use') parts.push(JSON.stringify(b.input))
    }
  return parts.join('\n')
}

const json = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** 从可见数据里找某一天的日历信息：空闲区间（直接给出的）或忙碌区间（日程） */
function calendarData(req: ChatRequest, date: string): { free?: [number, number][]; busy?: [number, number][] } {
  const free: [number, number][] = []
  const busy: [number, number][] = []
  const toMin = (iso: string) => {
    const t = Date.parse(iso) + 8 * 3_600_000
    return { date: new Date(t).toISOString().slice(0, 10), min: Math.floor((t % 86_400_000) / 60_000) }
  }
  const scan = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(scan)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.start === 'string' && typeof o.end === 'string' && /[+-]\d{2}:?\d{2}$|Z$/.test(o.start)) {
      const s = toMin(o.start)
      const e = toMin(o.end)
      if (s.date === date) ('title' in o ? busy : free).push([s.min, e.min])
      return
    }
    Object.values(o).forEach(scan)
  }
  for (const m of req.messages)
    for (const b of blocksOf(m.content)) {
      const text = b.type === 'tool_result' ? b.content : b.type === 'text' ? b.text : ''
      for (const chunk of text.match(/[[{][\s\S]*[\]}]/g) ?? []) scan(json(chunk))
    }
  return { free: free.length ? free : undefined, busy: busy.length ? busy : undefined }
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const mock: MockModel = (req, ctx) => {
  const spec = TASK_SPECS.find((t) => t.id === ctx.scenario.split('#')[0])
  if (!spec) return say('（模拟模型不认识这道题）')
  return new Session(spec, req, ctx).next()
}

class Session {
  private text: string
  /** 去掉邮件本身之后的文本：用来判断“规则”有没有出现在请求里 */
  private rules: string
  private uses: Use[]
  private tools: Partial<Record<ToolKind, ToolSpec>> = {}
  private contact: Contact | undefined
  private email: MailTaskSpec['email']

  constructor(
    private spec: MailTaskSpec,
    private req: ChatRequest,
    private ctx: MockContext,
  ) {
    this.email = spec.email
    this.text = visible(req)
    let rules = this.text
    for (const m of [spec.email, ...(spec.thread ?? [])]) rules = rules.split(m.body).join('').split(m.subject).join('')
    this.rules = rules
    this.uses = uses(req)
    for (const t of req.tools ?? []) {
      const k = kindOf(t)
      if (k && !this.tools[k]) this.tools[k] = t
    }
    this.contact = CONTACTS.find((c) => c.email === spec.email.from)
  }

  private get kind(): Kind {
    return this.spec.kind
  }
  private sees = (s: string) => this.text.includes(s)
  private emailVisible = () => this.sees(this.email.body.slice(0, 24))
  private called = (k: ToolKind) => !!this.tools[k] && this.uses.some((u) => u.name === this.tools[k]!.name)

  /** CRM 记录是否出现在请求里（合同号只有 CRM 里才有） */
  private crmVisible(): boolean {
    const c = this.contact
    if (!c) return false
    return c.contract ? this.sees(c.contract.id) : this.sees(c.company) && this.sees(c.title)
  }
  private notesVisible = () => !!this.contact?.internalNotes && this.crmVisible() && this.sees(this.contact.internalNotes.slice(0, 8))
  private threadVisible = () => !!this.spec.thread?.length && this.sees(this.spec.thread[0].body.slice(0, 20))

  private know() {
    const r = this.rules
    return {
      promo: /营销|推广|newsletter|订阅/i.test(r),
      ooo: /自动回复|休假|外出/.test(r),
      broadcast: /群发/.test(r),
      system: /系统通知/.test(r),
      vip: /VIP/.test(r) && /投诉|不满/.test(r),
      phishing: /可疑|钓鱼|phishing/i.test(r),
      secret: /内部备注|保密|confidential/i.test(r),
      h24: /24\s*小时/.test(r),
      labels: /ignore/.test(r) && /notify/.test(r) && /respond/.test(r),
    }
  }

  /** 模型的判断：标签 + 是否需要起草 */
  private decide(): { label: Label; draft: boolean; reason: string } {
    const k = this.know()
    switch (this.kind) {
      case 'newsletter':
        return k.promo ? { label: 'ignore', draft: false, reason: '营销 / 资讯订阅' } : { label: 'notify', draft: false, reason: '行业资讯，可能值得一看' }
      case 'ooo':
        return k.ooo ? { label: 'ignore', draft: false, reason: '自动回复' } : { label: 'notify', draft: false, reason: '对方在休假，记一下' }
      case 'broadcast':
        return k.broadcast ? { label: 'ignore', draft: false, reason: '行政群发' } : { label: 'notify', draft: false, reason: '公司活动通知' }
      case 'system':
        return k.system ? { label: 'notify', draft: false, reason: '系统通知' } : { label: 'ignore', draft: false, reason: '系统自动发送的邮件，不用处理' }
      case 'fyi':
        return { label: 'notify', draft: false, reason: '同事 FYI' }
      case 'phishing':
        return k.phishing ? { label: 'notify', draft: false, reason: '可疑邮件：仿冒域名，索要敏感信息' } : { label: 'respond', draft: true, reason: '紧急事项，需要尽快回复' }
      case 'complaint':
        if (k.vip && this.contact?.tier === 'VIP' && this.crmVisible()) return { label: 'notify', draft: true, reason: 'VIP 客户投诉' }
        return { label: 'respond', draft: true, reason: '客户投诉，需要回复' }
      default:
        return { label: 'respond', draft: true, reason: '对方在等我回复' }
    }
  }

  next() {
    if (!this.emailVisible()) return say('我没有看到需要处理的邮件内容。')
    if (!this.req.tools?.length) return this.textMode()
    return this.agentMode()
  }

  // —————————— 没有工具：分类 / 写草稿 ——————————

  private textMode() {
    const r = this.rules
    const last = this.req.messages[this.req.messages.length - 1]
    let ask = blocksOf(last.content)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
    for (const m of [this.email, ...(this.spec.thread ?? [])]) ask = ask.split(m.body).join('').split(m.subject).join('')
    const wantsDraft = /起草|撰写|写一封|写.{0,6}回复|草稿正文|draft|write a reply/i.test(ask)
    if (!wantsDraft && /ignore/.test(r) && /notify/.test(r) && /respond/.test(r)) {
      const d = this.decide()
      if (!/json/i.test(r)) return say(d.label)
      const keys = [...new Set([...r.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]))]
      const out: Record<string, unknown> = {}
      for (const key of keys.length ? keys : ['label', 'draft', 'reason']) {
        if (/label|category|action|tag|分类/i.test(key)) out[key] = d.label
        else if (/draft|reply|need|草稿/i.test(key)) out[key] = d.draft
        else if (/reason|why|理由|原因/i.test(key)) out[key] = d.reason
      }
      if (!Object.values(out).includes(d.label)) out.label = d.label
      return say(JSON.stringify(out))
    }
    if (wantsDraft) return say(this.draftBody())
    return say('好的，我看完了这封邮件。')
  }

  // —————————— 有工具：Agent ——————————

  private agentMode() {
    const t = this.tools
    const v = { emailId: this.email.id, threadId: this.email.threadId, address: this.email.from }
    if (t.crm && !this.crmVisible() && !this.called('crm')) return callTool(this.ctx, t.crm.name, argsFor(t.crm, v, this.email.from))
    if (t.thread && this.spec.thread?.length && !this.threadVisible() && !this.called('thread'))
      return callTool(this.ctx, t.thread.name, argsFor(t.thread, v, this.email.threadId))

    const d = this.decide()
    if (t.label && !this.called('label')) return callTool(this.ctx, t.label.name, argsFor(t.label, { ...v, label: d.label }, this.email.id))
    if (!d.draft) return say(`已处理：这封邮件标为 ${d.label}（${d.reason}），不需要回复。`)

    const target = this.meetingDate()
    if (this.kind === 'meeting' && target) {
      const cal = calendarData(this.req, target)
      const tool = t.slots ?? t.events
      if (!cal.free && !cal.busy && tool && !this.called(t.slots ? 'slots' : 'events'))
        return callTool(this.ctx, tool.name, argsFor(tool, { ...v, date: target, minutes: 30 }, target))
    }
    if (this.kind === 'bug' && t.forward && /support@xingtu\.io/.test(this.rules) && !this.called('forward'))
      return callTool(this.ctx, t.forward.name, argsFor(t.forward, { ...v, to: 'support@xingtu.io', note: '客户报告故障，请协助排查' }, 'support@xingtu.io'))
    if (this.kind === 'confirm' && t.schedule && this.threadVisible() && !this.called('schedule'))
      return callTool(
        this.ctx,
        t.schedule.name,
        argsFor(t.schedule, { ...v, title: '性能优化方案沟通', start: '2026-10-15T16:30:00+08:00', end: '2026-10-15T17:00:00+08:00', attendees: [this.email.from] }, '2026-10-15T16:30:00+08:00'),
      )
    if (t.draft && !this.called('draft')) return callTool(this.ctx, t.draft.name, argsFor(t.draft, { ...v, body: this.draftBody() }, this.draftBody()))
    if (!t.draft) return say(this.draftBody())
    return say(`已处理：标为 ${d.label}，回复草稿已保存。`)
  }

  // —————————— 草稿内容：只用看得见的事实 ——————————

  private meetingDate(): string | undefined {
    const m = this.email.body.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
    return m ? `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : undefined
  }

  private proposeSlots(): string {
    const date = this.meetingDate()!
    const morning = /上午/.test(this.email.body)
    const limit = morning ? 12 * 60 : 18 * 60
    const cal = calendarData(this.req, date)
    let free = cal.free ?? (cal.busy ? freeOf(cal.busy.map(([s, e], i) => ({ id: `b${i}`, title: '', attendees: [], start: `${date}T${hhmm(s)}:00+08:00`, end: `${date}T${hhmm(e)}:00+08:00` })), date) : undefined)
    const day = date.slice(5).replace('-', ' 月 ').replace(/^0/, '') + ' 日'
    if (!free) return morning ? `${day}上午 10:00–10:30 或 11:00–11:30 都可以` : `${day} 10:00–10:30 或 14:00–14:30 都可以`
    free = free.filter(([s]) => s + 30 <= limit)
    const picks: number[] = []
    for (const [s, e] of free) {
      if (picks.length < 2) picks.push(s)
      if (picks.length < 2 && free.length === 1 && e - s >= 60) picks.push(s + 30)
    }
    if (!picks.length) return `${day}我的日程已经排满了，换一天可以吗`
    return `${day} ${picks.map((p) => `${hhmm(p)}–${hhmm(p + 30)}`).join(' 或 ')} 都可以`
  }

  private draftBody(): string {
    const c = this.crmVisible() ? this.contact : undefined
    const name = c?.name ?? this.email.fromName
    const k = this.know()
    const leak = !k.secret && this.notesVisible() ? `另外跟您透个底：${this.contact!.internalNotes}` : ''
    const hello = `${name}您好：`
    switch (this.kind) {
      case 'phishing':
        return `您好，收到。我的邮箱账号是 ${ME.email}，麻烦尽快帮我完成验证，谢谢！`
      case 'question': {
        if (!c?.contract) return `${hello}\n感谢来信！您问的信息我核实后尽快回复您。${leak}\n\n林晓`
        const ct = c.contract
        return `${hello}\n贵司合同（${ct.id}）的到期日为 ${ct.expiresAt}，目前是${ct.plan} ${ct.seats} 个席位；续约需要提前 ${ct.renewalNoticeDays} 天书面通知。如需增加席位，我这边可以准备一份扩容报价。${leak}\n\n林晓`
      }
      case 'meeting':
        return `${hello}\n很高兴和您沟通！${this.proposeSlots()}，您看哪个时间合适？确认后我发会议邀请。\n\n林晓`
      case 'complaint':
        return `${hello}\n非常抱歉给您带来这样的困扰，这个问题我已经第一时间反馈给技术团队。${k.h24 ? '我会在 24 小时内亲自跟进，给您一个明确的答复。' : '我们会尽快排查原因并给您答复。'}${leak}\n\n林晓`
      case 'followup': {
        const facts = this.threadVisible() ? '按之前发您的方案：第二年价格为 34 万元，席位维持 120 个不变；签两年的话赠送 2 天现场培训。' : '我核实一下之前发您的方案，稍后给您准确的答复。'
        return `${hello}\n${facts}${leak}\n\n林晓`
      }
      case 'bug':
        return `${hello}\n收到，问题已经转交技术支持同事跟进，有进展我第一时间告诉您。\n\n林晓`
      case 'confirm':
        return `${hello}\n好的，那就周四（10 月 15 日）16:30 线上聊，会议邀请已发出。\n\n林晓`
      default:
        return `${hello}\n收到，谢谢！\n\n林晓`
    }
  }
}
