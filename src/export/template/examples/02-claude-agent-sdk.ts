/**
 * 对照：runAgent + 审批 + MCP ≈ Claude Agent SDK（Claude Code 的 harness，自带循环、上下文管理、权限）
 * npm i @anthropic-ai/claude-agent-sdk zod
 * 文档：https://code.claude.com/docs/en/agent-sdk/typescript
 *       https://code.claude.com/docs/en/agent-sdk/custom-tools
 */
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// 自定义工具 = 进程内 MCP server（≈ 你在第 19 关写的 createMcpServer）
const nova = createSdkMcpServer({
  name: 'nova',
  tools: [
    tool(
      'search_orders',
      '按客户邮箱查询订单列表，可按状态过滤',
      { customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() },
      async ({ customer_email, status }) => ({
        content: [{ type: 'text', text: JSON.stringify(await myBackend.searchOrders(customer_email, status)) }],
      }),
    ),
    tool('cancel_order', '取消一个尚未发货的订单', { order_id: z.string(), reason: z.string() }, async ({ order_id, reason }) => ({
      content: [{ type: 'text', text: JSON.stringify(await myBackend.cancelOrder(order_id, reason)) }],
    })),
  ],
})

for await (const msg of query({
  prompt: '我是 alice@example.com，帮我取消还没发货的门锁订单',
  options: {
    systemPrompt: '你是 Nova 科技的客服 Agent。',
    maxTurns: 10, // ≈ maxSteps
    mcpServers: { nova },
    // 最小权限（≈ 第 17 关的 scopeTools）：MCP 工具名格式为 mcp__<server>__<tool>
    allowedTools: ['mcp__nova__search_orders', 'mcp__nova__cancel_order'],
    // 人工审批（≈ 第 12 关）：高风险工具先问人
    canUseTool: async (toolName, input) => {
      if (toolName === 'mcp__nova__cancel_order' && !(await askHumanApproval(toolName, input)))
        return { behavior: 'deny', message: '人工审批拒绝' }
      return { behavior: 'allow', updatedInput: input }
    },
  },
})) {
  if (msg.type === 'result' && msg.subtype === 'success') console.log(msg.result)
}

// —— 以下为示意用的占位实现 ——
declare const myBackend: {
  searchOrders(email: string, status?: string): Promise<unknown>
  cancelOrder(id: string, reason: string): Promise<unknown>
}
declare function askHumanApproval(tool: string, input: unknown): Promise<boolean>
