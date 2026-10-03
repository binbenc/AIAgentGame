import { chat, type Message, type ToolResultBlock, type ToolUseBlock } from 'agent-quest'
import { executeToolCalls, type AgentOptions } from './agent'
import { withRetry } from './resilience'
import { textOf, type Tool } from './tools'

/** 有副作用、需要人工审批的工具：requiresApproval: true */
export type ApprovalTool = Tool & { requiresApproval?: boolean }

export interface PendingCall {
  toolUseId: string
  name: string
  input: unknown
}

/** 暂停时的完整快照：只包含纯数据，可以存进数据库、过几个小时再恢复 */
export interface AgentState {
  messages: Message[]
  steps: number
  /** 本轮已经执行完的工具结果（安全工具 / 已审批的工具） */
  results: ToolResultBlock[]
  /** 本轮还在等审批的工具调用 */
  waiting: ToolUseBlock[]
}

export type RunResult =
  | { status: 'done'; output: string; state: AgentState }
  | { status: 'max_steps'; output: string; state: AgentState }
  | { status: 'needs_approval'; pending: PendingCall; state: AgentState }

export interface Decision {
  approve: boolean
  note?: string
}

function needsApproval(call: ToolUseBlock, tools: ApprovalTool[]): boolean {
  return !!tools.find((t) => t.spec.name === call.name)?.requiresApproval
}

function pause(state: AgentState): RunResult {
  const c = state.waiting[0]
  return { status: 'needs_approval', pending: { toolUseId: c.id, name: c.name, input: c.input }, state }
}

/** 本轮所有工具都有结果了：按 tool_use 的原始顺序放进同一条 user 消息 */
function flushTurn(state: AgentState): void {
  const last = state.messages[state.messages.length - 1]
  const order = Array.isArray(last.content) ? last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => b.id) : []
  const results = [...state.results].sort((a, b) => order.indexOf(a.tool_use_id) - order.indexOf(b.tool_use_id))
  state.messages.push({ role: 'user', content: results })
  state.results = []
}

async function loop(state: AgentState, tools: ApprovalTool[], opts: AgentOptions): Promise<RunResult> {
  const maxSteps = opts.maxSteps ?? 10
  while (state.steps < maxSteps) {
    const res = await withRetry(
      () => chat({ system: opts.system, model: opts.model, tools: tools.map((t) => t.spec), messages: state.messages }),
      { retries: opts.retries ?? 3 },
    )
    state.steps++
    state.messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'tool_use') return { status: 'done', output: textOf(res.content), state }

    const calls = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    const safe = calls.filter((c) => !needsApproval(c, tools))
    const danger = calls.filter((c) => needsApproval(c, tools))
    // 安全的工具照常执行；危险的工具先不执行，等人拍板
    state.results = await executeToolCalls(safe, tools, opts)
    state.waiting = danger
    if (danger.length) return pause(state)
    flushTurn(state)
  }
  return { status: 'max_steps', output: '', state }
}

export async function runWithApproval(task: string, tools: ApprovalTool[], opts: AgentOptions = {}): Promise<RunResult> {
  const state: AgentState = { messages: [{ role: 'user', content: task }], steps: 0, results: [], waiting: [] }
  return loop(state, tools, opts)
}

export async function resumeWithApproval(
  saved: AgentState,
  decision: Decision,
  tools: ApprovalTool[],
  opts: AgentOptions = {},
): Promise<RunResult> {
  // 不修改传进来的快照：同一份快照可以被重复读取、审计
  const state: AgentState = JSON.parse(JSON.stringify(saved))
  const call = state.waiting.shift()
  if (!call) throw new Error('这个状态没有等待审批的工具调用')

  if (decision.approve) {
    state.results.push(...(await executeToolCalls([call], tools, opts)))
  } else {
    state.results.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: `人工审批拒绝：${decision.note ?? '未说明原因'}`,
      is_error: true,
    })
  }

  // 同一轮里还有别的危险调用：继续等下一个审批
  if (state.waiting.length) return pause(state)
  flushTurn(state)
  return loop(state, tools, opts)
}
