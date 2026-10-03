/**
 * 浏览器里的 MCP（Model Context Protocol）环境：
 * - 内存传输层：一对互相连通的 Transport，JSON-RPC 2.0 消息以对象形式异步传递（带虚拟延迟），并记录完整报文日志；
 * - 第三方 “Nova 智能家居设备” MCP 服务器：已经实现好，玩家的 MCP 客户端要连上它。
 */
import { __delay, __traced } from '../../engine/runtime/api'
import type { JSONSchema } from '../../engine/llm/types'

export const MCP_PROTOCOL_VERSION = '2025-06-18'

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
  /** 把一条消息发给对端 */
  send(message: JsonRpcMessage): Promise<void>
  /** 注册收到消息时的回调 */
  onMessage(handler: (message: JsonRpcMessage) => void): void
}

export interface WireEntry {
  from: 'client' | 'server'
  message: JsonRpcMessage
}

/** 创建一对连通的内存传输：client 端发出的消息会到达 server 端，反之亦然 */
export function createLinkedTransports(latencyMs = 2): { client: Transport; server: Transport; log: WireEntry[] } {
  const log: WireEntry[] = []
  const handlers: Record<'client' | 'server', ((m: JsonRpcMessage) => void) | undefined> = { client: undefined, server: undefined }
  const side = (me: 'client' | 'server'): Transport => {
    const peer = me === 'client' ? 'server' : 'client'
    return {
      async send(message) {
        const copy = structuredClone(message) // 模拟序列化：对端拿到的是副本
        log.push({ from: me, message: structuredClone(message) })
        void __delay(latencyMs).then(() => handlers[peer]?.(copy))
      },
      onMessage(handler) {
        handlers[me] = handler
      },
    }
  }
  return { client: side('client'), server: side('server'), log }
}

// ---------------------------------------------------------------- 第三方设备服务器

export interface Device {
  id: string
  name: string
  room: string
  type: 'air_conditioner' | 'light'
  power: 'on' | 'off'
  temperature?: number
}

interface DeviceTool {
  name: string
  title: string
  description: string
  inputSchema: JSONSchema
  delayMs: number
  run(args: any): string
}

class ToolError extends Error {}

const PAGE_SIZE = 2

/** 第三方提供的 “Nova 智能家居设备” MCP 服务器（tools/list 分页，每页 2 个工具） */
export function createDeviceMcpServer() {
  const devices: Device[] = [
    { id: 'ac-living', name: '客厅空调', room: '客厅', type: 'air_conditioner', power: 'on', temperature: 26 },
    { id: 'ac-bedroom', name: '卧室空调', room: '卧室', type: 'air_conditioner', power: 'off', temperature: 25 },
    { id: 'light-living', name: '客厅主灯', room: '客厅', type: 'light', power: 'on' },
  ]
  const setTemperature = __traced('device.setTemperature', (id: string, celsius: number) => {
    const d = devices.find((x) => x.id === id)
    if (!d) throw new ToolError(`设备 ${id} 不存在，请先调用 list_devices 查看设备 id`)
    if (d.type !== 'air_conditioner') throw new ToolError(`设备 ${d.name}（${id}）不是空调，不能设置温度`)
    if (!Number.isInteger(celsius) || celsius < 16 || celsius > 30) throw new ToolError(`温度 ${celsius}℃ 超出范围，可设置范围是 16~30℃ 的整数`)
    d.temperature = celsius
    d.power = 'on'
    return { ...d }
  })
  const tools: DeviceTool[] = [
    {
      name: 'list_devices',
      title: '列出设备',
      description: '列出用户家中所有智能设备，返回设备 id、名称、房间、类型、开关状态和当前温度。',
      inputSchema: { type: 'object', properties: {} },
      delayMs: 50,
      run: () => JSON.stringify(devices),
    },
    {
      name: 'set_temperature',
      title: '设置空调温度',
      description: '把某台空调设置到指定温度（16~30℃ 的整数），空调关机时会自动开机。',
      inputSchema: {
        type: 'object',
        properties: {
          device_id: { type: 'string', description: '设备 id，例如 ac-living' },
          celsius: { type: 'integer', minimum: 16, maximum: 30, description: '目标温度（摄氏度）' },
        },
        required: ['device_id', 'celsius'],
      },
      delayMs: 300,
      run: () => '',
    },
    {
      name: 'firmware.check_update',
      title: '检查固件更新',
      description: '检查某台设备是否有可用的固件更新。',
      inputSchema: { type: 'object', properties: { device_id: { type: 'string', description: '设备 id' } }, required: ['device_id'] },
      delayMs: 100,
      run: (a) => {
        if (!devices.some((d) => d.id === a.device_id)) throw new ToolError(`设备 ${a.device_id} 不存在`)
        return `设备 ${a.device_id} 的固件已是最新版本 v2.3.1`
      },
    },
  ]

  const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
  const fail = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

  async function handle(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (!('method' in msg)) return null // 服务端不处理响应
    if (!('id' in msg) || msg.id === undefined) return null // 通知：不回复
    const { id, method, params } = msg as JsonRpcRequest
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'nova-devices', title: 'Nova 智能家居设备', version: '3.2.0' },
          instructions: '控制 Nova 智能家居设备。修改设备状态前，先用 list_devices 确认设备 id。',
        })
      case 'ping':
        return ok(id, {})
      case 'tools/list': {
        const start = params?.cursor ? Number(String(params.cursor).replace('page-', '')) : 0
        if (!Number.isInteger(start) || start < 0 || start >= tools.length) return fail(id, -32602, `无效的 cursor：${params?.cursor}`)
        const page = tools.slice(start, start + PAGE_SIZE).map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }))
        const next = start + PAGE_SIZE
        return ok(id, next < tools.length ? { tools: page, nextCursor: `page-${next}` } : { tools: page })
      }
      case 'tools/call': {
        const tool = tools.find((t) => t.name === params?.name)
        if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`)
        await __delay(tool.delayMs)
        const args = params?.arguments ?? {}
        try {
          const text = tool.name === 'set_temperature' ? JSON.stringify(await setTemperature(args.device_id, args.celsius)) : tool.run(args)
          return ok(id, { content: [{ type: 'text', text }], isError: false })
        } catch (e) {
          if (!(e instanceof ToolError)) throw e
          // 工具执行失败：是“结果”，不是协议错误，模型可以据此调整
          return ok(id, { content: [{ type: 'text', text: e.message }], isError: true })
        }
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`)
    }
  }

  return {
    devices,
    handle,
    connect(transport: Transport) {
      transport.onMessage(async (m) => {
        const res = await handle(m)
        if (res) await transport.send(res)
      })
    },
  }
}
