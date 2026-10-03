import { chat, type Message } from 'agent-quest'
import { z } from 'zod'

export const TicketSchema = z.object({
  category: z.enum(['billing', 'bug', 'account', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(100),
  orderId: z.string().regex(/^NV-\d{6}$/).nullable(),
})
export type Ticket = z.infer<typeof TicketSchema>

const SYSTEM = `You triage support emails for Nova Tech. Read the customer's email and output a single JSON object, with no other text.
Fields:
- category: "billing" | "bug" | "account" | "other"
- priority: "low" | "medium" | "high"
- summary: a one-sentence summary, at most 80 characters
- orderId: an order id like "NV-123456"; null if the email doesn't mention one`

/** Dig the JSON out of a model answer: handles ```json fences and extra text before/after the object */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object found in the answer')
  return JSON.parse(body.slice(start, end + 1))
}

export async function extractTicket(email: string, maxRetries = 2): Promise<Ticket> {
  const messages: Message[] = [{ role: 'user', content: email }]
  let lastError = ''
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await chat({ system: SYSTEM, messages, max_tokens: 1024 })
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    try {
      const parsed = TicketSchema.safeParse(parseJsonLoose(text))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    } catch (e) {
      lastError = (e as Error).message
    }
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `Your output is invalid: ${lastError}. Fix it and output only the JSON.` })
  }
  throw new Error(`Failed to extract the ticket (after ${maxRetries} retries): ${lastError}`)
}
