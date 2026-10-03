import { chat, type ChatRequest, type ChatResponse, type Message, type ModelTier, type ToolResultBlock, type ToolUseBlock } from 'agent-quest'
import { withRetry, withTimeout } from './resilience'
import { textOf, toToolContent, type Tool } from './tools'

export interface AgentOptions {
  system?: string
  model?: ModelTier
  maxSteps?: number
  /** LLM 调用的最大重试次数 */
  retries?: number
  /** 单个工具的执行超时 */
  toolTimeoutMs?: number
  /** 依赖注入：替换底层的模型调用（埋点、缓存、预算……），默认用 agent-quest 的 chat */
  chat?: (req: ChatRequest) => Promise<ChatResponse>
}

export interface AgentResult {
  output: string
  steps: number
  messages: Message[]
  stopReason: 'done' | 'max_steps'
}

function errorResult(call: ToolUseBlock, message: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: call.id, content: `错误：${message}`, is_error: true }
}

/** 校验模型给出的参数：必须是对象，且包含所有必填字段 */
export function checkInput(tool: Tool, input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return `参数必须是 JSON 对象，收到的是：${JSON.stringify(input)}`
  const missing = (tool.spec.input_schema.required ?? []).filter((k) => !(k in input))
  return missing.length ? `参数缺少必填字段：${missing.join(', ')}` : null
}

export async function executeToolCalls(calls: ToolUseBlock[], tools: Tool[], opts: AgentOptions = {}): Promise<ToolResultBlock[]> {
  return Promise.all(
    calls.map(async (call): Promise<ToolResultBlock> => {
      const tool = tools.find((t) => t.spec.name === call.name)
      if (!tool) return errorResult(call, `不存在工具 "${call.name}"。可用工具：${tools.map((t) => t.spec.name).join(', ')}`)
      const problem = checkInput(tool, call.input)
      if (problem) return errorResult(call, problem)
      try {
        const output = await withTimeout(Promise.resolve(tool.run(call.input)), opts.toolTimeoutMs ?? 10_000, `工具 ${call.name} `)
        return { type: 'tool_result', tool_use_id: call.id, content: toToolContent(output) }
      } catch (e) {
        // 工具出错不让 Agent 崩溃：把错误作为结果交给模型，让它自己调整
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
