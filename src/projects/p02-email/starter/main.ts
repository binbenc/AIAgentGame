import { chat, textOf } from 'agent-quest'
// 提示：前面关卡写好的模块可以直接复用
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'
// import { parseJsonLoose } from '../../structured'

export type Label = 'ignore' | 'notify' | 'respond'

export interface Email {
  id: string
  threadId: string
  from: string
  fromName: string
  to: string
  subject: string
  body: string
  /** ISO 8601，带时区 */
  receivedAt: string
}

export interface Contact {
  name: string
  title: string
  email: string
  company: string
  /** VIP / normal（普通客户）/ internal（公司同事） */
  tier: 'VIP' | 'normal' | 'internal'
  owner: string
  contract: { id: string; plan: string; seats: number; expiresAt: string; renewalNoticeDays: number } | null
  /** 内部备注：只给自己人看 */
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
  /** 邮箱主人（客户经理林晓） */
  me: { name: string; email: string; title: string; company: string; timezone: string; workingHours: string }
  /** 邮件处理规则（Markdown） */
  rules: string
  /** 场景里的“现在”（ISO 8601） */
  now(): string
  inbox: {
    /** 某个会话里的全部邮件（按时间排序，包含当前这封） */
    thread(threadId: string): Promise<Email[]>
    search(query: string): Promise<Email[]>
  }
  crm: {
    /** 按邮箱查联系人；查不到返回 null */
    findContact(email: string): Promise<Contact | null>
    search(query: string): Promise<Contact[]>
  }
  calendar: {
    /** 某一天（YYYY-MM-DD，北京时间）我的全部日程 */
    listEvents(date: string): Promise<CalEvent[]>
    /** 某一天我在工作时间内的空闲时间段 */
    freeSlots(date: string, minutes?: number): Promise<{ start: string; end: string }[]>
  }
  label(emailId: string, label: Label): Promise<void>
  /** 创建回复草稿（不会发送） */
  createDraft(emailId: string, body: string): Promise<{ draftId: string }>
  forward(emailId: string, to: string, note?: string): Promise<void>
  /** start / end 必须是带时区的 ISO 8601 */
  scheduleMeeting(meeting: { title: string; start: string; end: string; attendees: string[] }): Promise<CalEvent>
}

/**
 * 邮件分拣助手的入口：每封新邮件调用一次。打标签（env.label），需要时起草回复（env.createDraft）。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function triage(email: Email, env: MailEnv): Promise<void> {
  // 最朴素的版本：让模型凭感觉分类，需要回复就让它凭感觉写一封。
  // 没给规则、没查 CRM、没看往来邮件、没查日历——试试看它会出什么错。
  const res = await chat({
    messages: [{ role: 'user', content: `请判断这封邮件该怎么处理，只回答 ignore、notify、respond 之一。\n\n发件人：${email.fromName} <${email.from}>\n主题：${email.subject}\n\n${email.body}` }],
  })
  const text = textOf(res.content).toLowerCase()
  const label: Label = text.includes('respond') ? 'respond' : text.includes('ignore') ? 'ignore' : 'notify'
  await env.label(email.id, label)
  if (label === 'respond') {
    const draft = await chat({ messages: [{ role: 'user', content: `替我（客户经理林晓）给这封邮件写一封回复：\n\n主题：${email.subject}\n\n${email.body}` }] })
    await env.createDraft(email.id, textOf(draft.content))
  }
}
