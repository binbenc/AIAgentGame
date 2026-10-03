/**
 * 对照：runAgent ≈ LangGraph.js 的 createReactAgent（ReAct 循环做成了一张图）
 * npm i @langchain/langgraph @langchain/core @langchain/anthropic zod
 * 文档：https://langchain-ai.github.io/langgraphjs/
 * 注意：API 细节以官方文档为准（这里只用来对照概念）。
 */
import { ChatAnthropic } from '@langchain/anthropic'
import { tool } from '@langchain/core/tools'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'

const searchOrders = tool(async ({ customer_email, status }) => JSON.stringify(await myBackend.searchOrders(customer_email, status)), {
  name: 'search_orders',
  description: '按客户邮箱查询订单列表，可按状态过滤',
  schema: z.object({ customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() }),
})

const agent = createReactAgent({ llm: new ChatAnthropic({ model: 'claude-opus-5-5' }), tools: [searchOrders] })

const out = await agent.invoke(
  { messages: [{ role: 'user', content: '我是 bob@example.com，有哪些已发货的订单？' }] },
  { recursionLimit: 20 }, // ≈ maxSteps
)
console.log(out.messages.at(-1)?.content)

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
