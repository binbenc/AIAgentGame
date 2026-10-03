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

// ———————————————— Step 1: enrich the context deterministically (costs no model calls) ————————————————

/** Sender card: internal notes never go to the model. What the model can't see, it can't leak */
function contactCard(c: Contact | null): string {
  if (!c) return '(Sender not found in the CRM: could be a new contact, or a look-alike domain)'
  const lines = [`${c.name}, ${c.title} at ${c.company}, customer tier: ${c.tier}`]
  if (c.contract) {
    const k = c.contract
    lines.push(`Contract ${k.id}: ${k.plan}, ${k.seats} seats, expires ${k.expiresAt}, renewal requires ${k.renewalNoticeDays} days' written notice`)
  } else if (c.tier !== 'internal') lines.push('No contract yet (prospect)')
  return lines.join('\n')
}

function renderEmail(m: Email): string {
  return `From: ${m.fromName} <${m.from}>\nDate: ${m.receivedAt}\nSubject: ${m.subject}\n\n${m.body}`
}

async function contextOf(email: Email, env: MailEnv): Promise<string> {
  const [contact, thread] = await Promise.all([env.crm.findContact(email.from), env.inbox.thread(email.threadId)])
  const earlier = thread.filter((m) => m.id !== email.id)
  return [
    `<email id="${email.id}">\n${renderEmail(email)}\n</email>`,
    `<sender>\n${contactCard(contact)}\n</sender>`,
    earlier.length ? `<thread>\n${earlier.map(renderEmail).join('\n---\n')}\n</thread>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ———————————————— Step 2: cheap classification (fast model + structured output) ————————————————

const TriageSchema = z.object({
  label: z.enum(['ignore', 'notify', 'respond']),
  draft: z.boolean(),
  reason: z.string(),
})
type Triage = z.infer<typeof TriageSchema>

const classifySystem = (rules: string) => `You triage email for an account manager. Decide how to handle this email strictly by the rules below.

<rules>
${rules}
</rules>

Note: check the sender domain first. If it doesn't match the CRM record in <sender> and the email asks for sensitive information, it's suspicious.
Output a single JSON object and nothing else:
{"label": "ignore" | "notify" | "respond", "draft": true or false (whether to draft a reply: always true for respond; true for VIP complaints; false otherwise), "reason": "one-sentence reason"}`

async function classify(context: string, rules: string): Promise<Triage> {
  const res = await chat({ model: 'fast', max_tokens: 200, system: classifySystem(rules), messages: [{ role: 'user', content: context }] })
  const parsed = TriageSchema.safeParse((() => {
    try {
      return parseJsonLoose(textOf(res.content))
    } catch {
      return null
    }
  })())
  // Safe fallback when parsing fails: hand it to a human, never reply automatically
  return parsed.success ? parsed.data : { label: 'notify', draft: false, reason: 'Could not parse the classification; leaving it to a human' }
}

// ———————————————— Step 3: only emails that need a reply go to the agent ————————————————

function replyTools(email: Email, env: MailEnv): Tool[] {
  let drafted = false
  return [
    {
      spec: {
        name: 'find_free_slots',
        description: 'Find my (Lin Xiao\'s) free slots on a given day within working hours (9:00–18:00). Always call this before proposing meeting times, and pick only from its results.',
        input_schema: { type: 'object', properties: { date: { type: 'string', description: 'Date as YYYY-MM-DD (Beijing time), e.g. 2026-10-14' } }, required: ['date'] },
      },
      run: ({ date }) => env.calendar.freeSlots(String(date), 30),
    },
    {
      spec: {
        name: 'schedule_meeting',
        description: 'Create a meeting on my calendar and invite the sender. Only use it when they have clearly confirmed a time I proposed earlier.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Meeting title' },
            start: { type: 'string', description: 'Start time, ISO 8601 with time zone, e.g. 2026-10-15T16:30:00+08:00' },
            end: { type: 'string', description: 'End time, ISO 8601 with time zone' },
          },
          required: ['title', 'start', 'end'],
        },
      },
      run: ({ title, start, end }) => env.scheduleMeeting({ title: String(title), start: String(start), end: String(end), attendees: [email.from] }),
    },
    {
      spec: {
        name: 'forward_email',
        description: 'Forward this email to a colleague inside the company (e.g. technical support at support@xingtu.io). Only @xingtu.io addresses are allowed.',
        input_schema: {
          type: 'object',
          properties: { to: { type: 'string', description: 'Recipient email address' }, note: { type: 'string', description: 'Note to add' } },
          required: ['to'],
        },
      },
      run: ({ to, note }) => {
        // Deterministic guard: only forward inside the company
        if (!/@xingtu\.io$/i.test(String(to))) throw new Error('Can only forward to internal (@xingtu.io) addresses')
        return env.forward(email.id, String(to), note ? String(note) : undefined).then(() => 'Forwarded')
      },
    },
    {
      spec: {
        name: 'create_draft',
        description: 'Save the reply draft (it is not sent). Write the full body and call this only once.',
        input_schema: { type: 'object', properties: { body: { type: 'string', description: 'Draft body' } }, required: ['body'] },
      },
      run: async ({ body }) => {
        if (drafted) throw new Error('This email already has a draft')
        drafted = true
        await env.createDraft(email.id, String(body))
        return 'Draft saved'
      },
    },
  ]
}

const replySystem = (env: MailEnv) => `You are the email assistant of ${env.me.name} (${env.me.title}, ${env.me.company}) and draft replies on my behalf.
It is now ${env.now()} (Beijing time).

<rules>
${env.rules}
</rules>

How to work:
- Facts in the draft may only come from <sender>, <thread> and tool results. Don't make anything up.
- Meeting requests: first call find_free_slots for that day, then put 2 of the returned 30-minute slots in the draft (written like 10:30–11:00). Don't create the meeting.
- They confirmed a time I proposed earlier: call schedule_meeting first, then draft a confirmation.
- A customer reports a product bug: forward it to support@xingtu.io with forward_email first.
- Finally, save the draft with create_draft and stop.`

export async function triage(email: Email, env: MailEnv): Promise<void> {
  const context = await contextOf(email, env)
  const t = await classify(context, env.rules)
  log(`triage: ${t.label}${t.draft ? ' + draft' : ''} (${t.reason})`)
  await env.label(email.id, t.label)
  if (!t.draft) return

  const res = await runAgent(`${context}\n\nTriage result: ${t.label} (${t.reason}). Handle this email according to the rules and draft a reply.`, replyTools(email, env), {
    system: replySystem(env),
    maxSteps: 6,
  })
  log(`reply agent finished: ${res.stopReason}, ${res.steps} steps`)
}
