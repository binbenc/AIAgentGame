/**
 * Comparison: runAgent ≈ Agent + run() in the OpenAI Agents SDK
 * npm i @openai/agents zod
 * Docs: https://openai.github.io/openai-agents-js/
 * Note: the official docs are authoritative on API details (this is only for comparing concepts).
 */
import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'

const searchOrders = tool({
  name: 'search_orders',
  description: 'Look up orders by customer email, optionally filtered by status',
  parameters: z.object({
    customer_email: z.string(),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).nullable(),
  }),
  execute: async ({ customer_email, status }) => JSON.stringify(await myBackend.searchOrders(customer_email, status ?? undefined)),
})

const agent = new Agent({
  name: 'Nova Support',
  instructions: 'You are the customer support agent for Nova Tech.', // ≈ system
  tools: [searchOrders],
})

const result = await run(agent, "I'm bob@example.com, which of my orders have shipped?", { maxTurns: 10 })
console.log(result.finalOutput)

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
