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

/**
 * The agent loop (like the one in agent.ts), except that
 * when the model calls a requiresApproval tool, it doesn't run it and returns needs_approval instead.
 */
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
    // TODO: split calls into two groups: safe ones (run them with executeToolCalls) and requiresApproval ones (don't run yet)
    //   - Dangerous calls present: store the finished results in state.results and the dangerous calls in state.waiting,
    //     then return { status: 'needs_approval', pending: { toolUseId, name, input }, state }
    //   - No dangerous calls: put all results into one user message and keep looping
    state.messages.push({ role: 'user', content: await executeToolCalls(calls, tools, opts) })
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
  // TODO:
  //   1. Take the first call out of state.waiting
  //   2. Approved → executeToolCalls([call], tools, opts); rejected → add an is_error tool_result: `Rejected by human reviewer: ${note}`
  //   3. More calls still waiting for approval → return needs_approval again
  //   4. Otherwise: put all of this turn's tool_results (in tool_use order) into **one** user message, then continue with loop(state, tools, opts)
  throw new Error('TODO: implement resumeWithApproval()')
}
