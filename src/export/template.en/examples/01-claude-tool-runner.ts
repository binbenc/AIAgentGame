/**
 * Comparison: runAgent in src/agent.ts ≈ the Claude API Tool Runner
 * npm i @anthropic-ai/sdk zod
 * Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

const client = new Anthropic() // reads ANTHROPIC_API_KEY

// ≈ search_orders in toolkit.ts: schema defined with zod, run returns a string
const searchOrders = betaZodTool({
  name: 'search_orders',
  description: 'Look up orders by customer email, optionally filtered by status. Returns order id, date, product, amount and status.',
  inputSchema: z.object({
    customer_email: z.string().describe('Customer email'),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional().describe('Order status'),
  }),
  run: async (input) => JSON.stringify(await myBackend.searchOrders(input.customer_email, input.status)),
})

// ≈ a tool with side effects: Tool Runner has no built-in approval callback, so intercept inside run (see your approval.ts)
const cancelOrder = betaZodTool({
  name: 'cancel_order',
  description: 'Cancel an order that has not shipped yet. Use only when the user explicitly asks.',
  inputSchema: z.object({ order_id: z.string().describe('Order id, e.g. NV-100001'), reason: z.string() }),
  run: async (input) => {
    if (!(await askHumanApproval('cancel_order', input))) return 'A human reviewer rejected this cancellation'
    return JSON.stringify(await myBackend.cancelOrder(input.order_id, input.reason))
  },
})

const final = await client.beta.messages.toolRunner({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  max_iterations: 10, // ≈ maxSteps
  system: 'You are the customer support agent for Nova Tech.',
  tools: [searchOrders, cancelOrder],
  messages: [{ role: 'user', content: "I'm bob@example.com, which of my orders have shipped?" }],
})

// ≈ what you learned in Level 1: filter by type, don't assume content[0] is text
for (const block of final.content) if (block.type === 'text') console.log(block.text)
console.log('usage', final.usage)

// --- placeholder implementations for illustration ---
declare const myBackend: {
  searchOrders(email: string, status?: string): Promise<unknown>
  cancelOrder(id: string, reason: string): Promise<unknown>
}
declare function askHumanApproval(tool: string, input: unknown): Promise<boolean>
