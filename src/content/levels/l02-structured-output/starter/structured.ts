import { chat, type Message } from 'agent-quest'
import { z } from 'zod'

export const TicketSchema = z.object({
  category: z.enum(['billing', 'bug', 'account', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(100),
  orderId: z.string().regex(/^NV-\d{6}$/).nullable(),
})
export type Ticket = z.infer<typeof TicketSchema>

/** 从模型回答里抠出 JSON：兼容 ```json 代码块、前后有多余文字的情况 */
export function parseJsonLoose(text: string): unknown {
  // TODO
  return JSON.parse(text)
}

export async function extractTicket(email: string, maxRetries = 2): Promise<Ticket> {
  const messages: Message[] = [{ role: 'user', content: email }]
  // TODO 1：写 system prompt，要求只输出 JSON 并说明字段
  // TODO 2：循环：调用模型 → parseJsonLoose → TicketSchema.safeParse
  // TODO 3：失败时把原回答（assistant）和错误（user）追加进 messages 后重试
  // TODO 4：超过 maxRetries 后 throw
  const res = await chat({ messages })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return TicketSchema.parse(parseJsonLoose(text))
}
