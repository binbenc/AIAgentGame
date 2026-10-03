import { chat, textOf } from 'agent-quest'
// Hint: you can reuse the modules you wrote in earlier levels
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
  /** ISO 8601 with time zone */
  receivedAt: string
}

export interface Contact {
  name: string
  title: string
  email: string
  company: string
  /** VIP / normal (regular customer) / internal (colleague) */
  tier: 'VIP' | 'normal' | 'internal'
  owner: string
  contract: { id: string; plan: string; seats: number; expiresAt: string; renewalNoticeDays: number } | null
  /** Internal notes: for internal eyes only */
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
  /** Mailbox owner (account manager Lin Xiao) */
  me: { name: string; email: string; title: string; company: string; timezone: string; workingHours: string }
  /** Email handling rules (Markdown) */
  rules: string
  /** "Now" in the scenario (ISO 8601) */
  now(): string
  inbox: {
    /** All emails in a thread (oldest first, including the current one) */
    thread(threadId: string): Promise<Email[]>
    search(query: string): Promise<Email[]>
  }
  crm: {
    /** Look up a contact by email address; null if not found */
    findContact(email: string): Promise<Contact | null>
    search(query: string): Promise<Contact[]>
  }
  calendar: {
    /** All my events on a given day (YYYY-MM-DD, Beijing time) */
    listEvents(date: string): Promise<CalEvent[]>
    /** My free slots within working hours on a given day */
    freeSlots(date: string, minutes?: number): Promise<{ start: string; end: string }[]>
  }
  label(emailId: string, label: Label): Promise<void>
  /** Create a reply draft (never sent) */
  createDraft(emailId: string, body: string): Promise<{ draftId: string }>
  forward(emailId: string, to: string, note?: string): Promise<void>
  /** start / end must be ISO 8601 with a time zone */
  scheduleMeeting(meeting: { title: string; start: string; end: string; attendees: string[] }): Promise<CalEvent>
}

/**
 * Entry point of the email triage assistant, called once per new email. Label it (env.label) and draft a reply when needed (env.createDraft).
 * This is a project: there is no TODO list, the architecture is up to you. Read the brief first, then the task list.
 */
export async function triage(email: Email, env: MailEnv): Promise<void> {
  // The most naive version: let the model classify by gut feeling, and write a reply by gut feeling when needed.
  // No rules, no CRM lookup, no thread, no calendar: see what goes wrong.
  const res = await chat({
    messages: [{ role: 'user', content: `How should this email be handled? Answer with exactly one of: ignore, notify, respond.\n\nFrom: ${email.fromName} <${email.from}>\nSubject: ${email.subject}\n\n${email.body}` }],
  })
  const text = textOf(res.content).toLowerCase()
  const label: Label = text.includes('respond') ? 'respond' : text.includes('ignore') ? 'ignore' : 'notify'
  await env.label(email.id, label)
  if (label === 'respond') {
    const draft = await chat({ messages: [{ role: 'user', content: `Write a reply to this email on my behalf (account manager Lin Xiao):\n\nSubject: ${email.subject}\n\n${email.body}` }] })
    await env.createDraft(email.id, textOf(draft.content))
  }
}
