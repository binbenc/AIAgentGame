import { chat, type Usage } from 'agent-quest'

export interface AskResult {
  text: string
  usage: Usage
  truncated: boolean
}

export async function ask(question: string, opts: { system?: string; maxTokens?: number } = {}): Promise<AskResult> {
  // TODO 1：调用 chat({ system, max_tokens, messages: [{ role: 'user', content: question }] })
  // TODO 2：从 response.content 中拼出所有文本块（content 是块数组，第一个不一定是文本！）
  // TODO 3：根据 stop_reason 判断是否被截断
  throw new Error('TODO：实现 ask()')
}

// TODO 4：写一个 system prompt，让模型扮演 Nova 科技的客服助手
export const NOVA_SYSTEM = ''

export function askNova(question: string): Promise<AskResult> {
  return ask(question, { system: NOVA_SYSTEM })
}
