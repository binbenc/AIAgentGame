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

export const NOVA_SYSTEM = `你是 Nova 科技的智能客服助手 Nova Bot。
- 用简洁、友好的中文回答。
- 只回答与 Nova 产品、订单和售后相关的问题；不确定时如实说明。`

export function askNova(question: string): Promise<AskResult> {
  return ask(question, { system: NOVA_SYSTEM })
}
