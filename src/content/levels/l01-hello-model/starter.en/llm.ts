import { chat, type Usage } from 'agent-quest'

export interface AskResult {
  text: string
  usage: Usage
  truncated: boolean
}

export async function ask(question: string, opts: { system?: string; maxTokens?: number } = {}): Promise<AskResult> {
  // TODO 1: call chat({ system, max_tokens, messages: [{ role: 'user', content: question }] })
  // TODO 2: join all the text blocks in response.content (content is an array of blocks, and the first one isn't always text!)
  // TODO 3: use stop_reason to tell whether the answer was cut off
  throw new Error('TODO: implement ask()')
}

// TODO 4: write a system prompt that makes the model act as Nova Tech's support assistant
export const NOVA_SYSTEM = ''

export function askNova(question: string): Promise<AskResult> {
  return ask(question, { system: NOVA_SYSTEM })
}
