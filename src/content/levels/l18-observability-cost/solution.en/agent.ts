import { chat, type ChatRequest, type ChatResponse, type Message, type ModelTier, type ToolResultBlock, type ToolUseBlock } from 'agent-quest'
import { withRetry, withTimeout } from './resilience'
import { textOf, toToolContent, type Tool } from './tools'

export interface AgentOptions {
  system?: string
  model?: ModelTier
  maxSteps?: number
  /** Max retries for each LLM call */
  retries?: number
  /** Timeout for a single tool execution */
  toolTimeoutMs?: number
  /** Dependency injection: replace the underlying model call (tracing, caching, budgets...); defaults to chat from agent-quest */
  chat?: (req: ChatRequest) => Promise<ChatResponse>
}

export interface AgentResult {
  output: string
  steps: number
  messages: Message[]
  stopReason: 'done' | 'max_steps'
}

function errorResult(call: ToolUseBlock, message: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${message}`, is_error: true }
}

/** Validate the arguments the model produced: must be an object with every required field */
export function checkInput(tool: Tool, input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return `Arguments must be a JSON object, got: ${JSON.stringify(input)}`
  const missing = (tool.spec.input_schema.required ?? []).filter((k) => !(k in input))
  return missing.length ? `Missing required field(s): ${missing.join(', ')}` : null
}

export async function executeToolCalls(calls: ToolUseBlock[], tools: Tool[], opts: AgentOptions = {}): Promise<ToolResultBlock[]> {
  return Promise.all(
    calls.map(async (call): Promise<ToolResultBlock> => {
      const tool = tools.find((t) => t.spec.name === call.name)
      if (!tool) return errorResult(call, `Unknown tool "${call.name}". Available tools: ${tools.map((t) => t.spec.name).join(', ')}`)
      const problem = checkInput(tool, call.input)
      if (problem) return errorResult(call, problem)
      try {
        const output = await withTimeout(Promise.resolve(tool.run(call.input)), opts.toolTimeoutMs ?? 10_000, `Tool ${call.name}`)
        return { type: 'tool_result', tool_use_id: call.id, content: toToolContent(output) }
      } catch (e) {
        // A failing tool must not crash the agent: hand the error to the model as a result so it can adjust
        return errorResult(call, (e as Error).message)
      }
    }),
  )
}

export async function runAgent(task: string | Message[], tools: Tool[], opts: AgentOptions = {}): Promise<AgentResult> {
  const messages: Message[] = typeof task === 'string' ? [{ role: 'user', content: task }] : [...task]
  const maxSteps = opts.maxSteps ?? 10
  const callModel = opts.chat ?? chat

  for (let step = 1; step <= maxSteps; step++) {
    const res = await withRetry(
      () => callModel({ system: opts.system, model: opts.model, tools: tools.map((t) => t.spec), messages }),
      { retries: opts.retries ?? 3 },
    )
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'tool_use') return { output: textOf(res.content), steps: step, messages, stopReason: 'done' }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    messages.push({ role: 'user', content: await executeToolCalls(calls, tools, opts) })
  }
  return { output: '', steps: maxSteps, messages, stopReason: 'max_steps' }
}
