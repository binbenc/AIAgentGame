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

export const SUPPORT_SYSTEM = `你是 Nova 科技的客服 Agent，用简洁友好的中文回答。
- 产品使用、保修、退货、配送、安装等政策问题：先用 search_help_center 检索，只根据检索结果回答，并在结论后用 [块id] 标注出处。
- 订单相关问题：用订单工具查询或处理；取消订单需要人工审批，审批被拒绝时如实告诉用户。
- 用户提到长期有效的偏好时用 save_memory 记下来；不要保存任何敏感信息。
- 不确定的事情不要编造。`

/** 高风险工具：执行前先问人 */
export function requireApproval(tool: Tool, approve: SupportDeps['approve']): Tool {
  return {
    spec: tool.spec,
    run: async (input) => {
      if (!(await approve({ tool: tool.spec.name, input }))) throw new Error('人工审批未通过，操作没有执行')
      return tool.run(input)
    },
  }
}

/** 帮助中心检索工具 search_help_center */
export function helpCenterTool(kb: BM25Index): Tool {
  return {
    spec: {
      name: 'search_help_center',
      description: '检索 Nova 帮助中心（产品手册、保修、退货、配送、安装等政策）。回答政策和产品使用问题前先调用。返回最相关的若干段落及其 [块id]。',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索关键词或问题，例如“X1 滤网 清洗”' } },
        required: ['query'],
      },
    },
    run: (input) => {
      const hits = kb.search(String(input.query ?? ''), 3)
      return hits.length ? hits.map((h) => `[${h.chunk.id}]\n${h.chunk.text}`).join('\n\n') : '没有找到相关资料'
    },
  }
}

export function createSupportAgent(deps: SupportDeps): { tracer: Tracer; handle(userId: string, message: string): Promise<SupportReply> } {
  const tracer = createTracer()
  return {
    tracer,
    async handle(userId, message) {
      const model = routeModel(message)
      const state: GuardState = { untrustedSeen: [] }
      const tools: Tool[] = [
        ...createOrderTools(deps.orders).map((t) => (/cancel/.test(t.spec.name) ? requireApproval(t, deps.approve) : t)),
        untrustedTool(helpCenterTool(deps.kb), state),
        ...createMemoryTools(deps.memory, userId),
      ]
      const system = buildSystemWithMemories(`${SUPPORT_SYSTEM}\n\n${UNTRUSTED_POLICY}`, deps.memory.recall(userId, message, 3))
      const chatFn = instrument(withBudget(chat, { maxUsd: deps.maxUsdPerMessage ?? 0.05 }), tracer, { feature: 'support' })

      const before = tracer.spans.length
      const cost = () => tracer.spans.slice(before).reduce((n, s) => n + s.costUsd, 0)
      try {
        const r = await runAgent(message, tools, { system, model, chat: chatFn, maxSteps: 8 })
        if (r.stopReason === 'max_steps') return { reply: HANDOFF_REPLY, model, costUsd: cost(), handedOff: true }
        return { reply: redactSecrets(r.output), model, costUsd: cost(), handedOff: false }
      } catch (e) {
        if (e instanceof BudgetExceededError) return { reply: HANDOFF_REPLY, model, costUsd: cost(), handedOff: true }
        throw e
      }
    },
  }
}
