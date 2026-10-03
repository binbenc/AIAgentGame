/**
 * 对照：runAgent ≈ OpenAI Agents SDK 的 Agent + run()
 * npm i @openai/agents zod
 * 文档：https://openai.github.io/openai-agents-js/
 * 注意：API 细节以官方文档为准（这里只用来对照概念）。
 */
import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'

const searchOrders = tool({
  name: 'search_orders',
  description: '按客户邮箱查询订单列表，可按状态过滤',
  parameters: z.object({
    customer_email: z.string(),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).nullable(),
  }),
  execute: async ({ customer_email, status }) => JSON.stringify(await myBackend.searchOrders(customer_email, status ?? undefined)),
})

const agent = new Agent({
  name: 'Nova 客服',
  instructions: '你是 Nova 科技的客服 Agent。', // ≈ system
  tools: [searchOrders],
})

const result = await run(agent, '我是 bob@example.com，有哪些已发货的订单？', { maxTurns: 10 })
console.log(result.finalOutput)

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
