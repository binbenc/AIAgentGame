/**
 * 对照：你在第 19 关手写的 createMcpServer ≈ 官方 MCP TypeScript SDK
 * npm i @modelcontextprotocol/sdk zod
 * 文档：https://github.com/modelcontextprotocol/typescript-sdk
 * 用 stdio 传输启动后，Claude Desktop / Claude Code / 任何 MCP 客户端都能直接使用你的订单工具。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'nova-orders', version: '1.0.0' })

server.registerTool(
  'search_orders',
  {
    title: '查询订单',
    description: '按客户邮箱查询订单列表，可按状态过滤',
    inputSchema: { customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() },
  },
  async ({ customer_email, status }) => ({
    content: [{ type: 'text', text: JSON.stringify(await myBackend.searchOrders(customer_email, status)) }],
  }),
)

await server.connect(new StdioServerTransport())

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
