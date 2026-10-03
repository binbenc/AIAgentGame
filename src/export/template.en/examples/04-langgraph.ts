/**
 * Comparison: runAgent ≈ createReactAgent in LangGraph.js (the ReAct loop as a graph)
 * npm i @langchain/langgraph @langchain/core @langchain/anthropic zod
 * Docs: https://langchain-ai.github.io/langgraphjs/
 * Note: the official docs are authoritative on API details (this is only for comparing concepts).
 */
import { ChatAnthropic } from '@langchain/anthropic'
import { tool } from '@langchain/core/tools'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'

const searchOrders = tool(async ({ customer_email, status }) => JSON.stringify(await myBackend.searchOrders(customer_email, status)), {
  name: 'search_orders',
  description: 'Look up orders by customer email, optionally filtered by status',
  schema: z.object({ customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() }),
})

const agent = createReactAgent({ llm: new ChatAnthropic({ model: 'claude-opus-5-5' }), tools: [searchOrders] })

const out = await agent.invoke(
  { messages: [{ role: 'user', content: "I'm bob@example.com, which of my orders have shipped?" }] },
  { recursionLimit: 20 }, // ≈ maxSteps
)
console.log(out.messages.at(-1)?.content)

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
