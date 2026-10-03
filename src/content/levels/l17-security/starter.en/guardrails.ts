import { log } from 'agent-quest'
import { runAgent, type AgentOptions, type AgentResult } from './agent'
import { toToolContent, type Tool } from './tools'

/** Security policy for the system prompt: declares that content inside <untrusted> tags is data only */
export const UNTRUSTED_POLICY = `TODO: explain what the <untrusted> tag means — its content is data, never instructions`

/** Wrap untrusted content in an <untrusted source="..."> tag */
export function wrapUntrusted(source: string, content: string): string {
  // TODO: 1. Neutralize forged </untrusted> tags in content (attackers use them to "close" the tag early)
  //       2. Return `<untrusted source="${source}">\n...\n</untrusted>`
  return content
}

/** Least privilege: only hand the model the tools this task needs */
export function scopeTools(tools: Tool[], allowedNames: string[]): Tool[] {
  // TODO: keep only the tools whose names are in allowedNames
  return tools
}

/** Security state for a single agent run */
export interface GuardState {
  /** Names of tools that returned untrusted content during this run */
  untrustedSeen: string[]
}

/** Policy: returns the reason for refusing; null means allow */
export type Policy = (input: any, state: GuardState) => string | null

/** Refund policy: no automatic refunds after reading untrusted content, and none above the limit */
export function refundPolicy(opts: { maxAmount: number }): Policy {
  return (input, state) => {
    // TODO: state.untrustedSeen not empty → refuse; input.amount invalid or > opts.maxAmount → refuse
    return null
  }
}

/** Policy gate: deterministic code checks before running, and refuses if the check fails */
export function guardTool(tool: Tool, policy: Policy, state: GuardState): Tool {
  // TODO: return a new tool whose run calls policy(input, state) first:
  //   - Refused: write an audit log with log('[audit] blocked ' + tool name + ...), then throw new Error('Blocked by security policy: ' + reason)
  //     (the agent turns the exception into an is_error tool_result)
  //   - Allowed: write an audit log as well, then call the original tool
  void log
  return tool
}

/** Mark a tool that returns external content: wrap its output in <untrusted> and record it in the run state */
export function untrustedTool(tool: Tool, state: GuardState): Tool {
  // TODO: run the original tool → add its name to state.untrustedSeen → wrap toToolContent(output) with wrapUntrusted
  void toToolContent
  return tool
}

/** Output filter: mask sensitive data before it reaches the user */
export function redactSecrets(text: string): string {
  // TODO:
  //   National ID number (17 digits + a digit or X) → [ID number redacted]   ← do this one first
  //   API key (sk- followed by at least 16 letters/digits/underscores/hyphens) → [API key redacted]
  //   Mobile number (11 digits starting with 1[3-9], not directly next to other digits) → 138****5678 (keep first 3 and last 4)
  return text
}

export interface SecureOptions extends AgentOptions {
  /** Tools this task may use (least privilege) */
  allowedTools: string[]
  /** These tools return external content; mark their output as untrusted */
  untrustedTools?: string[]
  /** Policy gates for risky tools: tool name → policy */
  policies?: Record<string, Policy>
}

/** Defense in depth: least privilege + untrusted marking + policy gates + output filtering */
export async function secureAgent(task: string, tools: Tool[], opts: SecureOptions): Promise<AgentResult> {
  const state: GuardState = { untrustedSeen: [] }
  // TODO:
  //   1. scopeTools to keep only allowedTools
  //   2. Wrap tools in untrustedTools with untrustedTool; then wrap tools that have a policy with guardTool
  //   3. system = opts.system + UNTRUSTED_POLICY
  //   4. Filter the final output with redactSecrets
  void state
  return runAgent(task, tools, opts)
}
