/**
 * Comparison: the createMcpServer you wrote by hand in Level 19 ≈ the official MCP TypeScript SDK
 * npm i @modelcontextprotocol/sdk zod
 * Docs: https://github.com/modelcontextprotocol/typescript-sdk
 * Started over the stdio transport, your order tools work directly in Claude Desktop, Claude Code or any MCP client.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'nova-orders', version: '1.0.0' })

server.registerTool(
  'search_orders',
  {
    title: 'Search orders',
    description: 'Look up orders by customer email, optionally filtered by status',
    inputSchema: { customer_email: z.string(), status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional() },
  },
  async ({ customer_email, status }) => ({
    content: [{ type: 'text', text: JSON.stringify(await myBackend.searchOrders(customer_email, status)) }],
  }),
)

await server.connect(new StdioServerTransport())

declare const myBackend: { searchOrders(email: string, status?: string): Promise<unknown> }
