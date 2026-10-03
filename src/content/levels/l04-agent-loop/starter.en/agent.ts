import { chat, type Message, type ModelTier, type ToolResultBlock } from 'agent-quest'
import { textOf, toToolContent, type Tool } from './tools'

export interface AgentOptions {
  system?: string
  model?: ModelTier
  maxSteps?: number
}

export interface AgentResult {
  output: string
  steps: number
  messages: Message[]
  stopReason: 'done' | 'max_steps'
}

export async function runAgent(task: string | Message[], tools: Tool[], opts: AgentOptions = {}): Promise<AgentResult> {
  const messages: Message[] = typeof task === 'string' ? [{ role: 'user', content: task }] : [...task]
  const maxSteps = opts.maxSteps ?? 10

  // TODO: a while / for loop
  //   1. chat({ system, model, tools: tools.map(t => t.spec), messages })
  //   2. push the response as an assistant message
  //   3. if it isn't tool_use, return
  //   4. run all tool_use blocks in parallel (Promise.all) and put the results in one user message
  //   5. past maxSteps, return stopReason: 'max_steps'
  throw new Error('TODO: implement runAgent()')
}
