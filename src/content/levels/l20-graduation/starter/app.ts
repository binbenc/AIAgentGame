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
  /** 人工审批：返回 true 才允许执行高风险工具 */
  approve(req: { tool: string; input: unknown }): Promise<boolean>
  /** 单条消息的费用上限（美元） */
  maxUsdPerMessage?: number
}

export interface SupportReply {
  reply: string
  model: ModelTier
  costUsd: number
  handedOff: boolean
}

export const HANDOFF_REPLY = '这个问题我需要请人工客服协助处理，已为您转接，请稍候。'

export const SUPPORT_SYSTEM = `你是 Nova 科技的客服 Agent。TODO：写清楚职责、何时用哪个工具、引用帮助中心时用 [块id] 标注出处`

/** 高风险工具：执行前先问人 */
export function requireApproval(tool: Tool, approve: SupportDeps['approve']): Tool {
  // TODO
  return tool
}

/** 帮助中心检索工具 search_help_center */
export function helpCenterTool(kb: BM25Index): Tool {
  // TODO：spec（name: search_help_center，参数 query）+ run（kb.search(query, 3)，返回 [块id] 和正文）
  throw new Error('TODO：实现 helpCenterTool()')
}

export function createSupportAgent(deps: SupportDeps): { tracer: Tracer; handle(userId: string, message: string): Promise<SupportReply> } {
  const tracer = createTracer()
  return {
    tracer,
    async handle(userId, message) {
      // TODO：按 task.md 的 8 个步骤组装
      const res = await runAgent(message, createOrderTools(deps.orders))
      return { reply: res.output, model: 'default', costUsd: 0, handedOff: false }
    },
  }
}
