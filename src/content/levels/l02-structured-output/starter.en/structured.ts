import { chat, type Message } from 'agent-quest'
import { z } from 'zod'

export const TicketSchema = z.object({
  category: z.enum(['billing', 'bug', 'account', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(100),
  orderId: z.string().regex(/^NV-\d{6}$/).nullable(),
})
export type Ticket = z.infer<typeof TicketSchema>

/** Dig the JSON out of a model answer: handles ```json fences and extra text before/after the object */
export function parseJsonLoose(text: string): unknown {
  // TODO
  return JSON.parse(text)
}

export async function extractTicket(email: string, maxRetries = 2): Promise<Ticket> {
  const messages: Message[] = [{ role: 'user', content: email }]
  // TODO 1: write a system prompt that asks for JSON only and describes each field
  // TODO 2: loop: call the model → parseJsonLoose → TicketSchema.safeParse
  // TODO 3: on failure, append the original answer (assistant) and the error (user) to messages, then retry
  // TODO 4: throw once maxRetries is used up
  const res = await chat({ messages })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return TicketSchema.parse(parseJsonLoose(text))
}
