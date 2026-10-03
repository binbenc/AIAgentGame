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

  // TODO：while / for 循环
  //   1. chat({ system, model, tools: tools.map(t => t.spec), messages })
  //   2. 把响应 push 成 assistant 消息
  //   3. 不是 tool_use 就返回
  //   4. 并行执行所有 tool_use（Promise.all），结果放进同一条 user 消息
  //   5. 超过 maxSteps 返回 stopReason: 'max_steps'
  throw new Error('TODO：实现 runAgent()')
}
