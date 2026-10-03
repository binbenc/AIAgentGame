import type { JSONSchema } from 'agent-quest'
import { createOrderTools, type OrderApi } from './toolkit'
import { toToolContent, type Tool } from './tools'

// ------------------------------------------------------------------ 协议类型（JSON-RPC 2.0 + MCP）

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

// ------------------------------------------------------------------ 服务端

export interface McpServerInfo {
  name: string
  version: string
  tools: Tool[]
}

export function createMcpServer(info: McpServerInfo) {
  async function handle(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    // TODO：
    //   - 没有 method（是响应）或没有 id（是通知）→ 返回 null，不回复
    //   - initialize → { protocolVersion（版本协商）, capabilities: { tools: {...} }, serverInfo: { name, version } }
    //   - ping → {}
    //   - tools/list → { tools: [{ name, description, inputSchema }] }   ← 注意是 inputSchema（驼峰）
    //   - tools/call → { content: [{ type: 'text', text }], isError }
    //       工具不存在：JSON-RPC 错误 -32602；工具抛异常：正常 result，isError: true
    //   - 其它方法 → JSON-RPC 错误 -32601
    //   响应格式：{ jsonrpc: '2.0', id: 原样回传, result } 或 { jsonrpc: '2.0', id, error: { code, message } }
    void toToolContent
    throw new Error('TODO：实现 MCP 服务端 handle()')
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

/** 把第 5 关的订单工具通过 MCP 暴露出去 */
export function createOrderMcpServer(api: OrderApi) {
  return createMcpServer({ name: 'nova-orders', version: '1.0.0', tools: createOrderTools(api) })
}

// ------------------------------------------------------------------ 客户端

export interface McpClient {
  protocolVersion: string
  serverInfo: { name: string; version: string; [k: string]: unknown }
  capabilities: Record<string, unknown>
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: unknown): Promise<CallToolResult>
}

export async function connectMcp(transport: Transport, clientInfo = { name: 'nova-agent', version: '1.0.0' }): Promise<McpClient> {
  // TODO：
  //   1. 用自增 id 发请求，用 Map<id, {resolve, reject}> 等待对应的响应（响应可能乱序到达！）
  //      收到 error 时 reject 一个 McpError
  //   2. 握手：initialize（protocolVersion、capabilities、clientInfo）→ 等到响应 → 发通知 notifications/initialized（没有 id）
  //   3. listTools：tools/list，有 nextCursor 就带上 { cursor } 继续翻页
  //   4. callTool：tools/call，params 为 { name, arguments }
  void clientInfo
  throw new Error('TODO：实现 connectMcp()')
}

// ------------------------------------------------------------------ 适配成 Agent 工具

/** 加前缀并满足模型 API 的工具名规则：只允许 [a-zA-Z0-9_-]，最长 64 */
export function agentToolName(prefix: string, name: string): string {
  // TODO：`${prefix}__${name}`，非法字符替换成 _，截断到 64
  return name
}

export async function mcpToolsToAgentTools(client: Pick<McpClient, 'listTools' | 'callTool'>, prefix: string): Promise<Tool[]> {
  // TODO：listTools → 每个 MCP 工具转成 { spec: { name, description, input_schema }, run }
  //   run：用 MCP 上的原始名字 callTool；把 content 里的文本拼起来；isError 时 throw（Agent 会转成 is_error）
  throw new Error('TODO：实现 mcpToolsToAgentTools()')
}
