import type { JSONSchema } from 'agent-quest'
import { createOrderTools, type OrderApi } from './toolkit'
import { toToolContent, type Tool } from './tools'

// ------------------------------------------------------------------ Protocol types (JSON-RPC 2.0 + MCP)

export const PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26']

export type JsonRpcId = string | number
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: any
}
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  result?: any
  error?: { code: number; message: string; data?: unknown }
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export interface Transport {
  send(message: JsonRpcMessage): Promise<void>
  onMessage(handler: (message: JsonRpcMessage) => void): void
}

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: JSONSchema
}

export interface CallToolResult {
  content: { type: string; text?: string }[]
  isError?: boolean
}

export const ErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const

export class McpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

// ------------------------------------------------------------------ Server

export interface McpServerInfo {
  name: string
  version: string
  tools: Tool[]
}

export function createMcpServer(info: McpServerInfo) {
  async function handle(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    // TODO:
    //   - No method (it's a response) or no id (it's a notification) → return null, don't reply
    //   - initialize → { protocolVersion (negotiated), capabilities: { tools: {...} }, serverInfo: { name, version } }
    //   - ping → {}
    //   - tools/list → { tools: [{ name, description, inputSchema }] }   ← note: inputSchema (camelCase)
    //   - tools/call → { content: [{ type: 'text', text }], isError }
    //       unknown tool: JSON-RPC error -32602; tool throws: normal result with isError: true
    //   - any other method → JSON-RPC error -32601
    //   Response shape: { jsonrpc: '2.0', id: echoed back, result } or { jsonrpc: '2.0', id, error: { code, message } }
    void toToolContent
    throw new Error('TODO: implement the MCP server handle()')
  }

  return {
    handle,
    connect(transport: Transport) {
      transport.onMessage(async (m) => {
        const res = await handle(m)
        if (res) await transport.send(res)
      })
    },
  }
}

/** Expose the Level 5 order tools over MCP */
export function createOrderMcpServer(api: OrderApi) {
  return createMcpServer({ name: 'nova-orders', version: '1.0.0', tools: createOrderTools(api) })
}

// ------------------------------------------------------------------ Client

export interface McpClient {
  protocolVersion: string
  serverInfo: { name: string; version: string; [k: string]: unknown }
  capabilities: Record<string, unknown>
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: unknown): Promise<CallToolResult>
}

export async function connectMcp(transport: Transport, clientInfo = { name: 'nova-agent', version: '1.0.0' }): Promise<McpClient> {
  // TODO:
  //   1. Send requests with auto-incrementing ids and wait for the matching response via a Map<id, {resolve, reject}> (responses may arrive out of order!)
  //      reject with an McpError when you get an error
  //   2. Handshake: initialize (protocolVersion, capabilities, clientInfo) → wait for the response → send the notifications/initialized notification (no id)
  //   3. listTools: tools/list; while there's a nextCursor, fetch the next page with { cursor }
  //   4. callTool: tools/call with params { name, arguments }
  void clientInfo
  throw new Error('TODO: implement connectMcp()')
}

// ------------------------------------------------------------------ Adapting to agent tools

/** Add the prefix and satisfy the model API's tool-name rules: only [a-zA-Z0-9_-], at most 64 characters */
export function agentToolName(prefix: string, name: string): string {
  // TODO: `${prefix}__${name}`, replace invalid characters with _, truncate to 64
  return name
}

export async function mcpToolsToAgentTools(client: Pick<McpClient, 'listTools' | 'callTool'>, prefix: string): Promise<Tool[]> {
  // TODO: listTools → turn each MCP tool into { spec: { name, description, input_schema }, run }
  //   run: callTool with the original MCP name; join the text in content; throw when isError (the agent turns it into is_error)
  throw new Error('TODO: implement mcpToolsToAgentTools()')
}
