import { chat, type Message, type ToolResultBlock, type ToolUseBlock } from 'agent-quest'
import { executeToolCalls, type AgentOptions } from './agent'
import { withRetry } from './resilience'
import { textOf, type Tool } from './tools'

/** Tools with side effects that need human approval: requiresApproval: true */
export type ApprovalTool = Tool & { requiresApproval?: boolean }

export interface PendingCall {
  toolUseId: string
  name: string
  input: unknown
}

/** A full snapshot taken when pausing: plain data only, so it can go into a database and be resumed hours later */
export interface AgentState {
  messages: Message[]
  steps: number
  /** Tool results already produced this turn (safe tools / approved tools) */
  results: ToolResultBlock[]
  /** Tool calls from this turn still waiting for approval */
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

/** Every tool in this turn has a result: put them into one user message, in the original tool_use order */
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
    // Safe tools run as usual; dangerous ones wait until a human decides
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
  // Don't mutate the snapshot passed in: the same snapshot can be read again and audited
  const state: AgentState = JSON.parse(JSON.stringify(saved))
  const call = state.waiting.shift()
  if (!call) throw new Error('This state has no tool call waiting for approval')

  if (decision.approve) {
    state.results.push(...(await executeToolCalls([call], tools, opts)))
  } else {
    state.results.push({
      type: 'tool_result',
      tool_use_id: call.id,
      content: `Rejected by human reviewer: ${decision.note ?? 'no reason given'}`,
      is_error: true,
    })
  }

  // More dangerous calls in the same turn: wait for the next approval
  if (state.waiting.length) return pause(state)
  flushTurn(state)
  return loop(state, tools, opts)
}
