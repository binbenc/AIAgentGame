import { chat, type Usage } from 'agent-quest'

export interface AskResult {
  text: string
  usage: Usage
  truncated: boolean
}

export async function ask(question: string, opts: { system?: string; maxTokens?: number } = {}): Promise<AskResult> {
  const res = await chat({
    system: opts.system,
    max_tokens: opts.maxTokens,
    messages: [{ role: 'user', content: question }],
  })
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
  return { text, usage: res.usage, truncated: res.stop_reason === 'max_tokens' }
}

export const NOVA_SYSTEM = `You are Nova Bot, the customer support assistant for Nova Tech.
- Answer in clear, friendly, concise English.
- Only help with Nova products, orders and after-sales service; if you're not sure, say so.`

export function askNova(question: string): Promise<AskResult> {
  return ask(question, { system: NOVA_SYSTEM })
}
