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

/**
 * Agent 循环（和 agent.ts 里的类似），区别在于：
 * 模型调用了 requiresApproval 的工具时，不执行它，而是返回 needs_approval。
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
    // TODO：把 calls 分成两组：安全的（直接 executeToolCalls 执行）和 requiresApproval 的（先不执行）
    //   - 有危险调用：把已执行的结果存进 state.results，危险调用存进 state.waiting，
    //     返回 { status: 'needs_approval', pending: { toolUseId, name, input }, state }
    //   - 没有危险调用：所有结果放进同一条 user 消息，继续循环
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
  // TODO：
  //   1. 取出 state.waiting 里的第一个调用
  //   2. 批准 → executeToolCalls([call], tools, opts)；拒绝 → 回填 is_error 的 tool_result：`人工审批拒绝：${note}`
  //   3. 还有别的等待审批的调用 → 再次返回 needs_approval
  //   4. 否则：把本轮所有 tool_result（按 tool_use 的顺序）放进**同一条** user 消息，然后 loop(state, tools, opts) 继续
  throw new Error('TODO：实现 resumeWithApproval()')
}
