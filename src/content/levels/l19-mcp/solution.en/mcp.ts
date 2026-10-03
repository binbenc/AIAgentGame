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
  const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

  async function handle(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (!('method' in msg)) return null // it's a response: this server sends no requests, so ignore it
    if (!('id' in msg) || msg.id === undefined || msg.id === null) return null // notification: never reply
    const { id, method, params } = msg as JsonRpcRequest

    switch (method) {
      case 'initialize': {
        // Version negotiation: echo the client's version if we support it, otherwise return our latest
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
          // A tool failure is a result, not a protocol error: the model needs to see it and adjust
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
  let nextId = 1
  const pending = new Map<JsonRpcId, { resolve(v: any): void; reject(e: Error): void }>()

  transport.onMessage((m) => {
    if ('method' in m || !('id' in m) || m.id === null) return // requests/notifications from the server: this client doesn't handle them yet
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

  // Handshake: initialize → response → notifications/initialized; only then can other requests go out
  const init = await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo })
  if (!SUPPORTED_VERSIONS.includes(init.protocolVersion)) throw new McpError(ErrorCode.InvalidRequest, `Unsupported protocol version: ${init.protocolVersion}`)
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

// ------------------------------------------------------------------ Adapting to agent tools

/** Add the prefix and satisfy the model API's tool-name rules: only [a-zA-Z0-9_-], at most 64 characters */
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
      const res = await client.callTool(t.name, input) // Note: call it by its original name on the MCP server
      const text = res.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} content]`)).join('\n')
      if (res.isError) throw new Error(text) // the agent turns it into an is_error tool_result
      return text
    },
  }))
}
