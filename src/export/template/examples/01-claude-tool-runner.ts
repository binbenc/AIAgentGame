/**
 * 对照：src/agent.ts 的 runAgent ≈ Claude API 的 Tool Runner
 * npm i @anthropic-ai/sdk zod
 * 文档：https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

const client = new Anthropic() // 读取 ANTHROPIC_API_KEY

// ≈ toolkit.ts 里的 search_orders：schema 用 zod 定义，run 返回字符串
const searchOrders = betaZodTool({
  name: 'search_orders',
  description: '按客户邮箱查询订单列表，可按状态过滤。返回订单号、日期、商品、金额和状态。',
  inputSchema: z.object({
    customer_email: z.string().describe('客户邮箱'),
    status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional().describe('订单状态'),
  }),
  run: async (input) => JSON.stringify(await myBackend.searchOrders(input.customer_email, input.status)),
})

// ≈ 有副作用的工具：Tool Runner 没有内置审批回调，可以在 run 里拦截（参考你的 approval.ts）
const cancelOrder = betaZodTool({
  name: 'cancel_order',
  description: '取消一个尚未发货的订单。仅在用户明确要求时使用。',
  inputSchema: z.object({ order_id: z.string().describe('订单号，如 NV-100001'), reason: z.string() }),
  run: async (input) => {
    if (!(await askHumanApproval('cancel_order', input))) return '人工审批拒绝了这次取消'
    return JSON.stringify(await myBackend.cancelOrder(input.order_id, input.reason))
  },
})

const final = await client.beta.messages.toolRunner({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  max_iterations: 10, // ≈ maxSteps
  system: '你是 Nova 科技的客服 Agent。',
  tools: [searchOrders, cancelOrder],
  messages: [{ role: 'user', content: '我是 bob@example.com，帮我看看有哪些已发货的订单' }],
})

// ≈ 你在第 1 关学到的：按 type 过滤，不要假设 content[0] 是文本
for (const block of final.content) if (block.type === 'text') console.log(block.text)
console.log('usage', final.usage)

// —— 以下为示意用的占位实现 ——
declare const myBackend: {
  searchOrders(email: string, status?: string): Promise<unknown>
  cancelOrder(id: string, reason: string): Promise<unknown>
}
declare function askHumanApproval(tool: string, input: unknown): Promise<boolean>
