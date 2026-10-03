import { chat, log, textOf } from 'agent-quest'
import { z } from 'zod'
import { runAgent } from '../../agent'
import { parseJsonLoose } from '../../structured'
import type { Tool } from '../../tools'

export type Label = 'ignore' | 'notify' | 'respond'

export interface Email {
  id: string
  threadId: string
  from: string
  fromName: string
  to: string
  subject: string
  body: string
  receivedAt: string
}

export interface Contact {
  name: string
  title: string
  email: string
  company: string
  tier: 'VIP' | 'normal' | 'internal'
  owner: string
  contract: { id: string; plan: string; seats: number; expiresAt: string; renewalNoticeDays: number } | null
  internalNotes: string
}

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  attendees: string[]
}

export interface MailEnv {
  me: { name: string; email: string; title: string; company: string; timezone: string; workingHours: string }
  rules: string
  now(): string
  inbox: { thread(threadId: string): Promise<Email[]>; search(query: string): Promise<Email[]> }
  crm: { findContact(email: string): Promise<Contact | null>; search(query: string): Promise<Contact[]> }
  calendar: { listEvents(date: string): Promise<CalEvent[]>; freeSlots(date: string, minutes?: number): Promise<{ start: string; end: string }[]> }
  label(emailId: string, label: Label): Promise<void>
  createDraft(emailId: string, body: string): Promise<{ draftId: string }>
  forward(emailId: string, to: string, note?: string): Promise<void>
  scheduleMeeting(meeting: { title: string; start: string; end: string; attendees: string[] }): Promise<CalEvent>
}

// ———————————————— 第 1 步：确定性地补全上下文（不花模型的钱） ————————————————

/** 发件人卡片：内部备注一律不交给模型——模型看不到，就不可能泄露 */
function contactCard(c: Contact | null): string {
  if (!c) return '（CRM 里查不到这个发件人：可能是新联系人，也可能是仿冒的域名）'
  const lines = [`${c.name}，${c.company} ${c.title}，客户等级（tier）：${c.tier}`]
  if (c.contract) {
    const k = c.contract
    lines.push(`合同 ${k.id}：${k.plan}，${k.seats} 个席位，到期日 ${k.expiresAt}，续约需提前 ${k.renewalNoticeDays} 天书面通知`)
  } else if (c.tier !== 'internal') lines.push('暂无合同（潜在客户）')
  return lines.join('\n')
}

function renderEmail(m: Email): string {
  return `发件人：${m.fromName} <${m.from}>\n时间：${m.receivedAt}\n主题：${m.subject}\n\n${m.body}`
}

async function contextOf(email: Email, env: MailEnv): Promise<string> {
  const [contact, thread] = await Promise.all([env.crm.findContact(email.from), env.inbox.thread(email.threadId)])
  const earlier = thread.filter((m) => m.id !== email.id)
  return [
    `<邮件 id="${email.id}">\n${renderEmail(email)}\n</邮件>`,
    `<发件人>\n${contactCard(contact)}\n</发件人>`,
    earlier.length ? `<往来邮件>\n${earlier.map(renderEmail).join('\n---\n')}\n</往来邮件>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ———————————————— 第 2 步：便宜的分类（fast 模型 + 结构化输出） ————————————————

const TriageSchema = z.object({
  label: z.enum(['ignore', 'notify', 'respond']),
  draft: z.boolean(),
  reason: z.string(),
})
type Triage = z.infer<typeof TriageSchema>

const classifySystem = (rules: string) => `你是客户经理的邮件分拣助手。严格按照下面的规则判断这封邮件怎么处理。

<规则>
${rules}
</规则>

注意：先核对发件域名，和 <发件人> 里 CRM 的信息对不上、又索要敏感信息的，就是可疑邮件。
只输出一个 JSON 对象，不要输出其它文字：
{"label": "ignore" | "notify" | "respond", "draft": true 或 false（是否需要起草回复：respond 一律 true；VIP 客户投诉 true；其余 false）, "reason": "一句话理由"}`

async function classify(context: string, rules: string): Promise<Triage> {
  const res = await chat({ model: 'fast', max_tokens: 200, system: classifySystem(rules), messages: [{ role: 'user', content: context }] })
  const parsed = TriageSchema.safeParse((() => {
    try {
      return parseJsonLoose(textOf(res.content))
    } catch {
      return null
    }
  })())
  // 解析失败时的安全兜底：通知人来看，绝不自动回复
  return parsed.success ? parsed.data : { label: 'notify', draft: false, reason: '分类结果无法解析，交给人工' }
}

// ———————————————— 第 3 步：只有需要回复的邮件才进 Agent ————————————————

function replyTools(email: Email, env: MailEnv): Tool[] {
  let drafted = false
  return [
    {
      spec: {
        name: 'find_free_slots',
        description: '查询我（林晓）某一天在工作时间（9:00–18:00）内的空闲时间段。约会议前必须先查，只能从结果里挑时间。',
        input_schema: { type: 'object', properties: { date: { type: 'string', description: '日期，YYYY-MM-DD（北京时间），例如 2026-10-14' } }, required: ['date'] },
      },
      run: ({ date }) => env.calendar.freeSlots(String(date), 30),
    },
    {
      spec: {
        name: 'schedule_meeting',
        description: '在我的日历上建会并邀请对方。只在对方明确确认了之前提议的时间时使用。',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '会议标题' },
            start: { type: 'string', description: '开始时间，带时区的 ISO 8601，例如 2026-10-15T16:30:00+08:00' },
            end: { type: 'string', description: '结束时间，带时区的 ISO 8601' },
          },
          required: ['title', 'start', 'end'],
        },
      },
      run: ({ title, start, end }) => env.scheduleMeeting({ title: String(title), start: String(start), end: String(end), attendees: [email.from] }),
    },
    {
      spec: {
        name: 'forward_email',
        description: '把这封邮件转发给公司内部同事（例如技术支持 support@xingtu.io）。只能转发给 @xingtu.io 的地址。',
        input_schema: {
          type: 'object',
          properties: { to: { type: 'string', description: '收件人邮箱' }, note: { type: 'string', description: '附言' } },
          required: ['to'],
        },
      },
      run: ({ to, note }) => {
        // 确定性守卫：只允许转发到公司内部
        if (!/@xingtu\.io$/i.test(String(to))) throw new Error('只能转发给公司内部（@xingtu.io）的地址')
        return env.forward(email.id, String(to), note ? String(note) : undefined).then(() => '已转发')
      },
    },
    {
      spec: {
        name: 'create_draft',
        description: '保存回复草稿（不会发送）。正文写完整，只调用一次。',
        input_schema: { type: 'object', properties: { body: { type: 'string', description: '草稿正文' } }, required: ['body'] },
      },
      run: async ({ body }) => {
        if (drafted) throw new Error('这封邮件已经有草稿了')
        drafted = true
        await env.createDraft(email.id, String(body))
        return '草稿已保存'
      },
    },
  ]
}

const replySystem = (env: MailEnv) => `你是${env.me.name}（${env.me.company}${env.me.title}）的邮件助手，替我起草回复。
现在是 ${env.now()}（北京时间）。

<规则>
${env.rules}
</规则>

工作方式：
- 草稿里的事实只能来自 <发件人>、<往来邮件> 和工具结果，不要编造。
- 对方约会议：先用 find_free_slots 查我那天的空闲时间，从结果里挑 2 个 30 分钟时间段写进草稿（写成 10:30–11:00 这样的格式），不要建会。
- 对方确认了之前提议的时间：先用 schedule_meeting 建会，再起草确认回复。
- 客户报告产品故障：先用 forward_email 转发给 support@xingtu.io。
- 最后用 create_draft 保存草稿，然后结束。`

export async function triage(email: Email, env: MailEnv): Promise<void> {
  const context = await contextOf(email, env)
  const t = await classify(context, env.rules)
  log(`分拣：${t.label}${t.draft ? ' + 草稿' : ''}（${t.reason}）`)
  await env.label(email.id, t.label)
  if (!t.draft) return

  const res = await runAgent(`${context}\n\n分拣结果：${t.label}（${t.reason}）。请按规则处理这封邮件并起草回复。`, replyTools(email, env), {
    system: replySystem(env),
    maxSteps: 6,
  })
  log(`回复 Agent 结束：${res.stopReason}，${res.steps} 步`)
}
