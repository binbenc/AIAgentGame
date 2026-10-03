import { chat, type ModelTier } from 'agent-quest'
import { runAgent } from './agent'
import { buildSystemWithMemories, createMemoryTools, type MemoryStore } from './memory'
import { BudgetExceededError, createTracer, instrument, routeModel, withBudget, type Tracer } from './observability'
import type { BM25Index } from './rag'
import { redactSecrets, UNTRUSTED_POLICY, untrustedTool, type GuardState } from './guardrails'
import { createOrderTools, type OrderApi } from './toolkit'
import type { Tool } from './tools'

export interface SupportDeps {
  orders: OrderApi
  kb: BM25Index
  memory: MemoryStore
  /** Human approval: risky tools only run when this returns true */
  approve(req: { tool: string; input: unknown }): Promise<boolean>
  /** Cost cap per message (USD) */
  maxUsdPerMessage?: number
}

export interface SupportReply {
  reply: string
  model: ModelTier
  costUsd: number
  handedOff: boolean
}

export const HANDOFF_REPLY = "I need a human agent to help with this one. I've transferred you — please hold on."

export const SUPPORT_SYSTEM = `You are Nova Tech's support agent. TODO: spell out the responsibilities, when to use which tool, and to cite help-center content as [chunk id]`

/** Risky tools: ask a human before running */
export function requireApproval(tool: Tool, approve: SupportDeps['approve']): Tool {
  // TODO
  return tool
}

/** Help-center search tool: search_help_center */
export function helpCenterTool(kb: BM25Index): Tool {
  // TODO: spec (name: search_help_center, parameter query) + run (kb.search(query, 3), returning [chunk id] and text)
  throw new Error('TODO: implement helpCenterTool()')
}

export function createSupportAgent(deps: SupportDeps): { tracer: Tracer; handle(userId: string, message: string): Promise<SupportReply> } {
  const tracer = createTracer()
  return {
    tracer,
    async handle(userId, message) {
      // TODO: assemble it following the 8 steps in task.md
      const res = await runAgent(message, createOrderTools(deps.orders))
      return { reply: res.output, model: 'default', costUsd: 0, handedOff: false }
    },
  }
}
