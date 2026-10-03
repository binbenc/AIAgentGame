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
  const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

  async function handle(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (!('method' in msg)) return null // 收到的是响应：本服务端不发请求，忽略
    if (!('id' in msg) || msg.id === undefined || msg.id === null) return null // 通知：永远不回复
    const { id, method, params } = msg as JsonRpcRequest

    switch (method) {
      case 'initialize': {
        // 版本协商：支持客户端要求的版本就照搬，否则返回自己支持的最新版本
        const requested = params?.protocolVersion
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, version: info.version },
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, {
          tools: info.tools.map((t) => ({ name: t.spec.name, description: t.spec.description, inputSchema: t.spec.input_schema })),
        })
      case 'tools/call': {
        const tool = info.tools.find((t) => t.spec.name === params?.name)
        if (!tool) return fail(id, ErrorCode.InvalidParams, `Unknown tool: ${params?.name}`)
        try {
          const output = await tool.run(params?.arguments ?? {})
          return ok(id, { content: [{ type: 'text', text: toToolContent(output) }], isError: false })
        } catch (e) {
          // 工具执行出错是“结果”而不是协议错误：模型需要看到它并调整
          return ok(id, { content: [{ type: 'text', text: (e as Error).message }], isError: true })
        }
      }
      default:
        return fail(id, ErrorCode.MethodNotFound, `Method not found: ${method}`)
    }
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
  let nextId = 1
  const pending = new Map<JsonRpcId, { resolve(v: any): void; reject(e: Error): void }>()

  transport.onMessage((m) => {
    if ('method' in m || !('id' in m) || m.id === null) return // 服务端发来的请求/通知：本客户端暂不处理
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new McpError(m.error.code, m.error.message))
    else p.resolve(m.result)
  })

  function request(method: string, params?: unknown): Promise<any> {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      transport.send({ jsonrpc: '2.0', id, method, params }).catch((e) => {
        pending.delete(id)
        reject(e)
      })
    })
  }

  // 握手：initialize → 收到响应 → notifications/initialized，之后才能发其它请求
  const init = await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo })
  if (!SUPPORTED_VERSIONS.includes(init.protocolVersion)) throw new McpError(ErrorCode.InvalidRequest, `不支持的协议版本：${init.protocolVersion}`)
  await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  return {
    protocolVersion: init.protocolVersion,
    serverInfo: init.serverInfo,
    capabilities: init.capabilities ?? {},
    async listTools() {
      const tools: McpTool[] = []
      let cursor: string | undefined
      do {
        const page = await request('tools/list', cursor ? { cursor } : {})
        tools.push(...page.tools)
        cursor = page.nextCursor
      } while (cursor)
      return tools
    },
    callTool: (name, args) => request('tools/call', { name, arguments: args }),
  }
}

// ------------------------------------------------------------------ 适配成 Agent 工具

/** 加前缀并满足模型 API 的工具名规则：只允许 [a-zA-Z0-9_-]，最长 64 */
export function agentToolName(prefix: string, name: string): string {
  return `${prefix}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

export async function mcpToolsToAgentTools(client: Pick<McpClient, 'listTools' | 'callTool'>, prefix: string): Promise<Tool[]> {
  const tools = await client.listTools()
  return tools.map((t) => ({
    spec: {
      name: agentToolName(prefix, t.name),
      description: t.description ?? t.title ?? t.name,
      input_schema: { ...t.inputSchema, type: 'object' },
    },
    run: async (input: unknown) => {
      const res = await client.callTool(t.name, input) // 注意：调用时用 MCP 服务器上的原始名字
      const text = res.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} 内容]`)).join('\n')
      if (res.isError) throw new Error(text) // Agent 会把它转成 is_error 的 tool_result
      return text
    },
  }))
}
