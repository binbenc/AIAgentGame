import { chat, type Message } from 'agent-quest'
import { z } from 'zod'

export const TicketSchema = z.object({
  category: z.enum(['billing', 'bug', 'account', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(100),
  orderId: z.string().regex(/^NV-\d{6}$/).nullable(),
})
export type Ticket = z.infer<typeof TicketSchema>

const SYSTEM = `你是 Nova 科技的工单分拣器。阅读用户邮件，只输出一个 JSON 对象，不要输出任何其它文字。
字段：
- category: "billing" | "bug" | "account" | "other"
- priority: "low" | "medium" | "high"
- summary: 不超过 50 字的一句话摘要
- orderId: 形如 "NV-123456" 的订单号；邮件里没有就填 null`

/** 从模型回答里抠出 JSON：兼容 ```json 代码块、前后有多余文字的情况 */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('回答里没有找到 JSON 对象')
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
    messages.push({ role: 'user', content: `你的输出不符合要求：${lastError}。请修正后只输出 JSON。` })
  }
  throw new Error(`提取工单失败（已重试 ${maxRetries} 次）：${lastError}`)
}
