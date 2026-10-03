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

export const SUPPORT_SYSTEM = `You are Nova Tech's support agent. Answer in concise, friendly English.
- Questions about product usage, warranty, returns, shipping, installation and other policies: search with search_help_center first, answer only from the results, and cite the source after each claim as [chunk id].
- Order questions: use the order tools to look up or act on orders. Cancelling an order needs human approval; if it's rejected, tell the user honestly.
- When the user mentions a lasting preference, save it with save_memory. Never save sensitive information.
- If you're not sure about something, don't make it up.`

/** Risky tools: ask a human before running */
export function requireApproval(tool: Tool, approve: SupportDeps['approve']): Tool {
  return {
    spec: tool.spec,
    run: async (input) => {
      if (!(await approve({ tool: tool.spec.name, input }))) throw new Error('Human approval was denied; the action was not executed')
      return tool.run(input)
    },
  }
}

/** Help-center search tool: search_help_center */
export function helpCenterTool(kb: BM25Index): Tool {
  return {
    spec: {
      name: 'search_help_center',
      description:
        'Search the Nova help center (product manuals and policies on warranty, returns, shipping, installation, etc.). Call it before answering policy or product-usage questions. Returns the most relevant passages with their [chunk id].',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search keywords or a question, e.g. "X1 filter cleaning"' } },
        required: ['query'],
      },
    },
    run: (input) => {
      const hits = kb.search(String(input.query ?? ''), 3)
      return hits.length ? hits.map((h) => `[${h.chunk.id}]\n${h.chunk.text}`).join('\n\n') : 'No relevant results found'
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
