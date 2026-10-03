import { chat, type Message, type ModelTier, type ToolResultBlock, type ToolUseBlock } from 'agent-quest'
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

export async function executeToolCalls(calls: ToolUseBlock[], tools: Tool[]): Promise<ToolResultBlock[]> {
  return Promise.all(
    calls.map(async (call) => {
      const tool = tools.find((t) => t.spec.name === call.name)!
      try {
        const output = await tool.run(call.input)
        return { type: 'tool_result' as const, tool_use_id: call.id, content: toToolContent(output) }
      } catch (e) {
        // 工具出错不让 Agent 崩溃：把错误作为结果交给模型，让它自己调整
        return { type: 'tool_result' as const, tool_use_id: call.id, content: `错误：${(e as Error).message}`, is_error: true }
      }
    }),
  )
}

export async function runAgent(task: string | Message[], tools: Tool[], opts: AgentOptions = {}): Promise<AgentResult> {
  const messages: Message[] = typeof task === 'string' ? [{ role: 'user', content: task }] : [...task]
  const maxSteps = opts.maxSteps ?? 10

  for (let step = 1; step <= maxSteps; step++) {
    const res = await chat({
      system: opts.system,
      model: opts.model,
      tools: tools.map((t) => t.spec),
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'tool_use') return { output: textOf(res.content), steps: step, messages, stopReason: 'done' }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    messages.push({ role: 'user', content: await executeToolCalls(calls, tools) })
  }
  return { output: '', steps: maxSteps, messages, stopReason: 'max_steps' }
}
