/**
 * Comparison: runAgent + approval + MCP ≈ the Claude Agent SDK (the Claude Code harness, with its own loop, context management and permissions)
 * npm i @anthropic-ai/claude-agent-sdk zod
 * Docs: https://code.claude.com/docs/en/agent-sdk/typescript
 *       https://code.claude.com/docs/en/agent-sdk/custom-tools
 */
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Custom tools = an in-process MCP server (≈ the createMcpServer you wrote in Level 19)
const nova = createSdkMcpServer({
  name: 'nova',
  tools: [
    tool(
      'search_orders',
      'Look up orders by customer email, optionally filtered by status',
      { customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() },
      async ({ customer_email, status }) => ({
        content: [{ type: 'text', text: JSON.stringify(await myBackend.searchOrders(customer_email, status)) }],
      }),
    ),
    tool('cancel_order', 'Cancel an order that has not shipped yet', { order_id: z.string(), reason: z.string() }, async ({ order_id, reason }) => ({
      content: [{ type: 'text', text: JSON.stringify(await myBackend.cancelOrder(order_id, reason)) }],
    })),
  ],
})

for await (const msg of query({
  prompt: "I'm alice@example.com, please cancel my smart lock order that hasn't shipped yet",
  options: {
    systemPrompt: 'You are the customer support agent for Nova Tech.',
    maxTurns: 10, // ≈ maxSteps
    mcpServers: { nova },
    // Least privilege (≈ scopeTools from Level 17): MCP tool names look like mcp__<server>__<tool>
    allowedTools: ['mcp__nova__search_orders', 'mcp__nova__cancel_order'],
    // Human approval (≈ Level 12): ask a human before high-risk tools
    canUseTool: async (toolName, input) => {
      if (toolName === 'mcp__nova__cancel_order' && !(await askHumanApproval(toolName, input)))
        return { behavior: 'deny', message: 'Rejected by human reviewer' }
      return { behavior: 'allow', updatedInput: input }
    },
  },
})) {
  if (msg.type === 'result' && msg.subtype === 'success') console.log(msg.result)
}

// --- placeholder implementations for illustration ---
declare const myBackend: {
  searchOrders(email: string, status?: string): Promise<unknown>
  cancelOrder(id: string, reason: string): Promise<unknown>
}
declare function askHumanApproval(tool: string, input: unknown): Promise<boolean>
