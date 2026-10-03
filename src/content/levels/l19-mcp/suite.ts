import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolResults, allToolUses, callTool, callTools, lastToolResults, say } from '../../../engine/llm/mock-kit'
import type { ChatRequest, JSONSchema, Message, ToolResultBlock, ToolSpec, ToolUseBlock } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
import { __delay } from '../../../engine/runtime/api'
import {
  createDeviceMcpServer,
  createLinkedTransports,
  MCP_PROTOCOL_VERSION,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type Transport,
} from '../../shared/mcp-env'
import { createNova, type Tool } from '../../shared/nova'

type McpTool = { name: string; title?: string; description?: string; inputSchema: JSONSchema }
type CallToolResult = { content: { type: string; text?: string }[]; isError?: boolean }
type McpClient = {
  protocolVersion: string
  serverInfo: { name: string; version: string }
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: unknown): Promise<CallToolResult>
}
type Server = { handle(m: JsonRpcMessage): Promise<JsonRpcResponse | null | undefined>; connect(t: Transport): void }
type Mod = {
  createMcpServer(info: { name: string; version: string; tools: Tool[] }): Server
  createOrderMcpServer(api: unknown): Server
  connectMcp(t: Transport): Promise<McpClient>
  mcpToolsToAgentTools(client: Pick<McpClient, 'listTools' | 'callTool'>, prefix: string): Promise<Tool[]>
}
type AgentMod = {
  runAgent(task: string, tools: Tool[]): Promise<{ output: string; messages: Message[] }>
  executeToolCalls(calls: ToolUseBlock[], tools: Tool[]): Promise<ToolResultBlock[]>
}

/** 键顺序无关的序列化，用来比较协议报文 */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`)
      .join(',')}}`
  return JSON.stringify(v)
}

/** 防止玩家的 Promise 永远不 resolve（例如 id 没对上）导致判题卡死 */
async function guard<T>(p: Promise<T>, what: string): Promise<T> {
  const timeout = __delay(10_000).then(() => {
    throw new Error(
      L(
        `${what}等了 10 秒仍没有结果——检查是不是请求 id 和响应没对上，或者忘了 resolve`,
        `${what}got no result after 10 seconds — check that request ids match their responses, and that you didn't forget to resolve`,
      ),
    )
  })
  return Promise.race([p, timeout])
}

const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/

function toolResults(messages: Message[]): ToolResultBlock[] {
  return messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b): b is ToolResultBlock => b.type === 'tool_result')
}

// ---------------------------------------------------------------- mock 用到的“看工具挑工具”

const byEnd = (req: ChatRequest, suffix: string) => (req.tools ?? []).find((t) => t.name.endsWith(suffix))
const usedEnd = (req: ChatRequest, suffix: string) => allToolUses(req).find((u) => u.name.endsWith(suffix))
const resultOf = (req: ChatRequest, use?: ToolUseBlock) => allToolResults(req).find((r) => r.tool_use_id === use?.id)

function prop(t: ToolSpec, re: RegExp, pred: (p: JSONSchema) => boolean = () => true): string | undefined {
  return Object.entries(t.input_schema.properties ?? {}).find(([k, v]) => re.test(`${k} ${v.description ?? ''}`) && pred(v))?.[0]
}

function orderSearchTool(req: ChatRequest): ToolSpec | undefined {
  const pool = (req.tools ?? []).filter((t) => t.name.startsWith('orders__'))
  const hit = (s: string) => ['search', 'query', '查询', 'list'].some((k) => s.toLowerCase().includes(k))
  return pool.find((t) => hit(t.name) && !/cancel|取消|policy|政策/.test(t.name)) ?? pool.find((t) => hit(t.description) && !/cancel|policy/.test(t.name))
}

function findDevice(req: ChatRequest, room: string): string | undefined {
  const r = resultOf(req, usedEnd(req, 'list_devices'))
  try {
    const list = JSON.parse(r?.content ?? '[]') as { id: string; name: string; type: string }[]
    return list.find((d) => d.name.includes(room) && d.type === 'air_conditioner')?.id
  } catch {
    return undefined
  }
}

const TASK_TWO = L(
  '把客厅空调调到 24 度。另外我的邮箱是 alice@example.com，帮我看看有哪些已发货的订单。',
  "Set the living room AC to 24 degrees. Also, my email is alice@example.com — which of my orders have shipped?",
)
const TASK_ERR = L('太热了，把卧室空调调到 35 度！', "It's way too hot, set the bedroom AC to 35 degrees!")
const LIVING = L('客厅', 'Living room')
const BEDROOM = L('卧室', 'Bedroom')

async function connectDevices(m: Mod) {
  const link = createLinkedTransports()
  const dev = createDeviceMcpServer()
  dev.connect(link.server)
  const client = await guard(m.connectMcp(link.client), 'connectMcp() ')
  return { link, dev, client }
}

export const suite: LevelSuite = {
  budgets: L({ calls: 6, tokens: 3900 }, { calls: 6, tokens: 3600 }),
  mock(req, ctx) {
    const last = lastToolResults(req)
    const listDev = byEnd(req, 'list_devices')
    const setTemp = byEnd(req, 'set_temperature')
    if (!listDev || !setTemp) return say(L('抱歉，我没有找到可以控制智能家居设备的工具。', "Sorry, I couldn't find any tools for controlling smart home devices."))
    if (!usedEnd(req, 'list_devices')) return callTool(ctx, listDev.name, {}, L('我先看看家里有哪些设备。', "Let me see what devices you have first."))

    if (ctx.scenario === 'two-servers') {
      if (!usedEnd(req, 'set_temperature')) {
        const id = findDevice(req, LIVING)
        if (!id) return say(L('没找到客厅空调。', "I couldn't find the living room AC."))
        const calls: { name: string; input: unknown }[] = [{ name: setTemp.name, input: { device_id: id, celsius: 24 } }]
        const search = orderSearchTool(req)
        const email = search && prop(search, /email|邮箱/i)
        if (search && email) {
          const status = prop(search, /status|状态/i, (p) => Array.isArray(p.enum) && p.enum.includes('shipped'))
          calls.push({ name: search.name, input: { [email]: 'alice@example.com', ...(status ? { [status]: 'shipped' } : {}) } })
        }
        return callTools(ctx, calls, L('我同时调温度、查订单。', "I'll set the temperature and look up your orders at the same time."))
      }
      const temp = resultOf(req, usedEnd(req, 'set_temperature'))
      const orders = last.find((r) => r !== temp)
      const parts = [temp?.is_error ? L(`调温失败：${temp.content}`, `Couldn't set the temperature: ${temp.content}`) : L('已把客厅空调调到 24℃。', 'Set the living room AC to 24℃.')]
      if (!orders) parts.push(L('不过我没找到查询订单的工具。', "But I couldn't find a tool to look up orders."))
      else {
        try {
          const list = JSON.parse(orders.content) as { id: string; product: string }[]
          parts.push(
            L(
              `您已发货的订单：${list.map((o) => `${o.id}（${o.product}）`).join('、')}。`,
              `Your shipped orders: ${list.map((o) => `${o.id} (${o.product})`).join(', ')}.`,
            ),
          )
        } catch {
          parts.push(L(`订单查询结果：${orders.content}`, `Order lookup result: ${orders.content}`))
        }
      }
      return say(parts.join(L('', ' ')))
    }

    // device-error：调到一个超出范围的温度
    if (!usedEnd(req, 'set_temperature')) {
      const id = findDevice(req, BEDROOM)
      return id ? callTool(ctx, setTemp.name, { device_id: id, celsius: 35 }) : say(L('没找到卧室空调。', "I couldn't find the bedroom AC."))
    }
    if (last[0]?.is_error)
      return say(
        L(
          `抱歉，没能把卧室空调调到 35 度：${last[0].content}。要不先调到 26 度？`,
          `Sorry, I couldn't set the bedroom AC to 35 degrees: ${last[0].content}. How about 26 instead?`,
        ),
      )
    return say(L('已把卧室空调调到 35 度。', 'Set the bedroom AC to 35 degrees.'))
  },
  scenarios: [
    {
      id: 'server-conformance',
      title: L('MCP 服务端协议一致性', 'MCP server protocol conformance'),
      async run(ctx: ScenarioCtx) {
        const { createMcpServer } = ctx.load<Mod>('mcp.ts')
        const echo: Tool = {
          spec: {
            name: 'echo',
            description: L('原样返回输入的文本。', 'Returns the input text unchanged.'),
            input_schema: { type: 'object', properties: { text: { type: 'string', description: L('要返回的文本', 'Text to return') } }, required: ['text'] },
          },
          run: (i) => ({ echoed: i.text }),
        }
        const DB_ERROR = L('数据库连接失败', 'Database connection failed')
        const boom: Tool = {
          spec: { name: 'boom', description: L('总是失败的工具。', 'A tool that always fails.'), input_schema: { type: 'object', properties: {} } },
          run: () => {
            throw new Error(DB_ERROR)
          },
        }
        const server = createMcpServer({ name: 'judge-server', version: '0.0.1', tools: [echo, boom] })
        const call = (m: object) => server.handle(m as JsonRpcMessage)
        const keys = (r: unknown) => Object.keys((r ?? {}) as object).sort()

        const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'judge', version: '0' } } })
        ctx.eq(keys(init), ['id', 'jsonrpc', 'result'], L('成功响应的信封只能有 jsonrpc、id、result 三个字段', 'A success response envelope must have exactly three fields: jsonrpc, id, result'))
        ctx.eq([init?.jsonrpc, init?.id], ['2.0', 1], L('jsonrpc 必须是 "2.0"，id 必须原样回传', 'jsonrpc must be "2.0" and the id must be echoed back unchanged'))
        ctx.eq(init?.result?.protocolVersion, MCP_PROTOCOL_VERSION, L('initialize 应返回协商后的 protocolVersion', 'initialize should return the negotiated protocolVersion'))
        ctx.eq(canon(init?.result?.serverInfo), canon({ name: 'judge-server', version: '0.0.1' }), L('serverInfo 应为 { name, version }', 'serverInfo should be { name, version }'))
        ctx.assert(typeof init?.result?.capabilities?.tools === 'object', L('capabilities 里要声明 tools 能力（例如 { tools: { listChanged: false } }），客户端据此知道可以调用 tools/*', 'capabilities must declare the tools capability (e.g. { tools: { listChanged: false } }) so the client knows it can call tools/*'))
        const old = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'judge', version: '0' } } })
        ctx.eq(old?.result?.protocolVersion, '2025-03-26', L('版本协商：客户端要求的版本在 SUPPORTED_VERSIONS 里时，原样返回该版本', "Version negotiation: when the client's requested version is in SUPPORTED_VERSIONS, return that version"))
        const weird = await call({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'judge', version: '0' } } })
        ctx.eq(weird?.result?.protocolVersion, MCP_PROTOCOL_VERSION, L('版本协商：不支持客户端的版本时，返回自己支持的最新版本，由客户端决定是否断开', "Version negotiation: if you don't support the client's version, return the latest version you support and let the client decide whether to disconnect"))

        const note = await call({ jsonrpc: '2.0', method: 'notifications/initialized' })
        ctx.assert(note == null, L(`通知（没有 id 的消息）永远不能回复，handle 应返回 null，实际返回了 ${JSON.stringify(note)}`, `Notifications (messages without an id) must never be answered; handle should return null, but returned ${JSON.stringify(note)}`))
        ctx.eq(canon(await call({ jsonrpc: '2.0', id: 4, method: 'ping' })), canon({ jsonrpc: '2.0', id: 4, result: {} }), L('ping 要返回空对象 result', 'ping should return an empty object as result'))

        const list = await call({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} })
        ctx.eq(list?.id, 'list-1', L('字符串 id 也要原样回传', 'String ids must be echoed back unchanged too'))
        const tools = (list?.result?.tools ?? []) as McpTool[]
        ctx.eq(
          canon(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))),
          canon([echo, boom].map((t) => ({ name: t.spec.name, description: t.spec.description, inputSchema: t.spec.input_schema }))),
          L('tools/list 应返回 { tools: [{ name, description, inputSchema }] }——MCP 用驼峰的 inputSchema，不是 input_schema', 'tools/list should return { tools: [{ name, description, inputSchema }] } — MCP uses camelCase inputSchema, not input_schema'),
        )

        const HELLO = L('你好', 'hello')
        const ok = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { text: HELLO } } })
        ctx.eq(ok?.result?.content?.[0]?.type, 'text', L('tools/call 的结果是 { content: [{ type: "text", text }] }', 'The tools/call result is { content: [{ type: "text", text }] }'))
        ctx.includes(ok?.result?.content?.[0]?.text, HELLO, L('工具输出要放进 content[0].text', 'Put the tool output in content[0].text'))
        ctx.assert(!ok?.result?.isError, L('成功的调用 isError 应为 false 或不写', 'For a successful call, isError should be false or omitted'))

        const bad = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom', arguments: {} } })
        ctx.eq(keys(bad), ['id', 'jsonrpc', 'result'], L('工具执行抛异常不是协议错误：应返回正常的 result（带 isError: true），而不是 error', 'A tool throwing is not a protocol error: return a normal result (with isError: true), not an error'))
        ctx.eq(bad?.result?.isError, true, L('工具执行失败时 result.isError 必须为 true', 'When the tool fails, result.isError must be true'))
        ctx.includes(bad?.result?.content?.[0]?.text, DB_ERROR, L('错误信息要放进 content，让模型看得到', 'Put the error message in content so the model can see it'))

        const unknownTool = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} } })
        ctx.eq([unknownTool?.id, unknownTool?.error?.code], [7, -32602], L('调用不存在的工具是参数错误：JSON-RPC error.code = -32602（Invalid params）', 'Calling an unknown tool is a params error: JSON-RPC error.code = -32602 (Invalid params)'))
        const unknown = await call({ jsonrpc: '2.0', id: 'abc', method: 'resources/list' })
        ctx.eq(keys(unknown), ['error', 'id', 'jsonrpc'], L('错误响应的信封只能有 jsonrpc、id、error，不能同时带 result', 'An error response envelope must have only jsonrpc, id and error — never a result as well'))
        ctx.eq([unknown?.id, unknown?.error?.code, typeof unknown?.error?.message], ['abc', -32601, 'string'], L('不支持的方法：error = { code: -32601（Method not found）, message }，id 原样回传', 'Unsupported method: error = { code: -32601 (Method not found), message }, with the id echoed back'))
      },
    },
    {
      id: 'handshake',
      title: L('MCP 客户端：握手、分页、并发与错误', 'MCP client: handshake, pagination, concurrency and errors'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('mcp.ts')
        const { link, client } = await connectDevices(m)
        const fromClient = link.log.filter((e) => e.from === 'client').map((e) => e.message as { id?: unknown; method?: string; params?: any })
        const first = fromClient[0]
        ctx.eq([first?.method, first?.id !== undefined], ['initialize', true], L('握手的第一条消息必须是 initialize 请求（带 id）', 'The first handshake message must be an initialize request (with an id)'))
        ctx.eq(first.params?.protocolVersion, MCP_PROTOCOL_VERSION, L(`initialize 要带上 protocolVersion: "${MCP_PROTOCOL_VERSION}"`, `initialize must include protocolVersion: "${MCP_PROTOCOL_VERSION}"`))
        ctx.assert(typeof first.params?.clientInfo?.name === 'string' && typeof first.params?.capabilities === 'object', L('initialize 的 params 要包含 capabilities 和 clientInfo: { name, version }', "initialize's params must include capabilities and clientInfo: { name, version }"))
        const second = fromClient[1]
        ctx.eq(second?.method, 'notifications/initialized', L('收到 initialize 响应后，要发送 notifications/initialized 通知', 'After the initialize response arrives, send the notifications/initialized notification'))
        ctx.assert(!('id' in (second ?? {})), L('notifications/initialized 是通知，不能带 id', 'notifications/initialized is a notification and must not have an id'))
        const respIdx = link.log.findIndex((e) => e.from === 'server' && (e.message as { id?: unknown }).id === first.id)
        const notifIdx = link.log.findIndex((e) => e.message === (second as unknown))
        ctx.assert(respIdx >= 0 && respIdx < notifIdx, L('必须等 initialize 的响应回来之后，才能发送 notifications/initialized', 'Wait for the initialize response before sending notifications/initialized'))
        ctx.eq(client.serverInfo?.name, 'nova-devices', L('client.serverInfo 应来自 initialize 响应', 'client.serverInfo should come from the initialize response'))

        const tools = await guard(client.listTools(), 'listTools() ')
        ctx.eq(tools.map((t) => t.name), ['list_devices', 'set_temperature', 'firmware.check_update'], L('tools/list 是分页的：响应里有 nextCursor 时，要带着 { cursor } 继续请求下一页', 'tools/list is paginated: when a response has nextCursor, request the next page with { cursor }'))

        // set_temperature 要 300ms，list_devices 只要 50ms：响应会乱序到达
        const [slow, fast] = await guard(
          Promise.all([client.callTool('set_temperature', { device_id: 'ac-living', celsius: 22 }), client.callTool('list_devices', {})]),
          L('并发的 callTool() ', 'Concurrent callTool() '),
        )
        const OUT_OF_ORDER = L('并发请求的响应会乱序到达，要按 id 把响应交给对应的请求', 'Responses to concurrent requests arrive out of order; route each response to its request by id')
        ctx.includes(slow?.content?.[0]?.text, '"temperature":22', OUT_OF_ORDER)
        ctx.includes(fast?.content?.[0]?.text, 'ac-bedroom', OUT_OF_ORDER)

        let msg = ''
        try {
          await guard(client.callTool('no_such_tool', {}), 'callTool() ')
        } catch (e) {
          msg = (e as Error).message
        }
        ctx.includes(msg, 'no_such_tool', L('服务端返回 JSON-RPC error 时，callTool 应该 reject，并带上服务端的错误信息', "When the server returns a JSON-RPC error, callTool should reject with the server's error message"))

        const ids = link.log.filter((e) => e.from === 'client' && 'id' in e.message).map((e) => (e.message as { id: unknown }).id)
        ctx.eq(new Set(ids).size, ids.length, L('同一个连接上的请求 id 不能重复', 'Request ids must be unique on a connection'))
      },
    },
    {
      id: 'adapter',
      title: L('MCP 工具 → Agent 工具', 'MCP tools → agent tools'),
      async run(ctx: ScenarioCtx) {
        const { mcpToolsToAgentTools } = ctx.load<Mod>('mcp.ts')
        const { executeToolCalls } = ctx.load<AgentMod>('agent.ts')
        const long = 'summarize_all_device_energy_usage_for_the_selected_billing_period_v2'
        const schema = { type: 'object', properties: { device_id: { type: 'string', description: L('设备 id', 'Device id') } }, required: ['device_id'] }
        const calledWith: string[] = []
        const CHECK_DESC = L('检查固件更新', 'Check for firmware updates')
        const RANGE = L('16~30', '16 to 30')
        const fake = {
          listTools: async (): Promise<McpTool[]> => [
            { name: 'firmware.check_update', description: CHECK_DESC, inputSchema: schema },
            { name: long, description: L('统计能耗', 'Summarize energy usage'), inputSchema: schema },
            { name: 'set_temperature', description: L('设置温度', 'Set temperature'), inputSchema: { type: 'object', properties: { device_id: { type: 'string' }, celsius: { type: 'integer' } }, required: ['device_id', 'celsius'] } },
          ],
          callTool: async (name: string, args: any): Promise<CallToolResult> => {
            calledWith.push(name)
            if (name === 'set_temperature' && args.celsius > 30) return { content: [{ type: 'text', text: L('温度超出范围，可设置 16~30℃', 'Temperature out of range; it must be 16 to 30℃') }], isError: true }
            return { content: [{ type: 'text', text: `ok:${name}` }] }
          },
        }
        const tools = await mcpToolsToAgentTools(fake, 'devices')
        const names = tools.map((t) => t.spec.name)
        ctx.eq(names[0], 'devices__firmware_check_update', L('工具名 = 前缀 + "__" + 原名，并把模型 API 不允许的字符（比如 "."）替换成 "_"', 'Tool name = prefix + "__" + original name, with characters the model API disallows (like ".") replaced by "_"'))
        ctx.eq(names[1], `devices__${long}`.slice(0, 64), L('模型 API 的工具名最长 64 个字符，超出要截断', 'Model API tool names are at most 64 characters; truncate longer ones'))
        ctx.assert(names.every((n) => VALID_NAME.test(n)), L(`工具名必须匹配 ^[a-zA-Z0-9_-]{1,64}$，实际：${names.join(', ')}`, `Tool names must match ^[a-zA-Z0-9_-]{1,64}$, got: ${names.join(', ')}`))
        ctx.eq(canon(tools[0].spec.input_schema), canon(schema), L('MCP 的 inputSchema 要原样转成 Agent 工具的 input_schema', "The MCP inputSchema should become the agent tool's input_schema unchanged"))
        ctx.eq(tools[0].spec.description, CHECK_DESC, L('description 要保留', 'Keep the description'))

        const results = await executeToolCalls(
          [
            { type: 'tool_use', id: 't1', name: 'devices__set_temperature', input: { device_id: 'ac-living', celsius: 35 } },
            { type: 'tool_use', id: 't2', name: 'devices__firmware_check_update', input: { device_id: 'ac-living' } },
          ],
          tools,
        )
        ctx.assert(results[0]?.is_error, L('MCP 返回 isError: true 时，Agent 拿到的 tool_result 也要是 is_error（在 run 里 throw 即可）', 'When MCP returns isError: true, the tool_result the agent gets must be is_error too (just throw in run)'))
        ctx.includes(results[0].content, RANGE, L('错误内容要传给模型', 'Pass the error content on to the model'))
        ctx.eq([results[1]?.is_error ?? false, results[1]?.content], [false, 'ok:firmware.check_update'], L('成功时返回 content 里的文本', 'On success, return the text from content'))
        ctx.assert(calledWith.includes('firmware.check_update'), L('callTool 要用 MCP 服务器上的原始工具名（firmware.check_update），而不是加了前缀的名字', "callTool must use the tool's original name on the MCP server (firmware.check_update), not the prefixed name"))
      },
    },
    {
      id: 'two-servers',
      title: L('一个 Agent，两个 MCP 服务器', 'One agent, two MCP servers'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('mcp.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const nova = createNova()
        const orderLink = createLinkedTransports()
        m.createOrderMcpServer(nova).connect(orderLink.server)
        const orders = await guard(m.connectMcp(orderLink.client), L('connectMcp()（订单服务器）', 'connectMcp() (order server) '))
        ctx.eq(orders.serverInfo?.name, 'nova-orders', L('createOrderMcpServer 的 serverInfo.name 应为 nova-orders', "createOrderMcpServer's serverInfo.name should be nova-orders"))
        const { dev, client: devices } = await connectDevices(m)
        const tools = [
          ...(await guard(m.mcpToolsToAgentTools(orders, 'orders'), L('订单工具适配 ', 'Adapting the order tools '))),
          ...(await guard(m.mcpToolsToAgentTools(devices, 'devices'), L('设备工具适配 ', 'Adapting the device tools '))),
        ]

        const r = await runAgent(TASK_TWO, tools)
        const names = (ctx.trace.llmCalls()[0]?.request.tools ?? []).map((t) => t.name)
        ctx.assert(names.some((n) => n.startsWith('orders__')) && names.some((n) => n.startsWith('devices__')), L(`模型应该同时拿到两个服务器的工具（orders__* 和 devices__*），实际：${names.join(', ')}`, `The model should get tools from both servers (orders__* and devices__*), got: ${names.join(', ')}`))
        ctx.eq(dev.devices.find((d) => d.id === 'ac-living')?.temperature, 24, L('客厅空调应该被调到 24 度', 'The living room AC should be set to 24 degrees'))
        ctx.eq(ctx.trace.toolCalls('searchOrders').length, 1, L('订单应通过你的 MCP 服务器查询', 'Orders should be looked up through your MCP server'))
        ctx.includes(r.output, 'NV-100001', L('回答里应包含已发货的订单', 'The answer should include the shipped orders'))
        ctx.includes(r.output, '24', L('回答里应确认温度', 'The answer should confirm the temperature'))
        const serverMsgs = orderLink.log.filter((e) => e.from === 'server').map((e) => e.message as { id?: unknown })
        ctx.assert(serverMsgs.every((x) => x.id !== undefined && x.id !== null), L('你的服务端回复了通知（notifications/initialized）——通知永远不能回复', 'Your server replied to a notification (notifications/initialized) — notifications must never be answered'))
      },
    },
    {
      id: 'device-error',
      title: L('工具出错：isError → is_error', 'Tool errors: isError → is_error'),
      async run(ctx: ScenarioCtx) {
        const m = ctx.load<Mod>('mcp.ts')
        const { runAgent } = ctx.load<AgentMod>('agent.ts')
        const { dev, client } = await connectDevices(m)
        const r = await runAgent(TASK_ERR, await guard(m.mcpToolsToAgentTools(client, 'devices'), L('设备工具适配 ', 'Adapting the device tools ')))
        const res = toolResults(r.messages).find((b) => b.content.includes(L('超出范围', 'out of range')))
        ctx.assert(res?.is_error, L('设备服务器返回 isError: true，Agent 收到的 tool_result 也必须标记 is_error', 'The device server returned isError: true, so the tool_result the agent receives must be marked is_error too'))
        ctx.eq(dev.devices.find((d) => d.id === 'ac-bedroom')?.temperature, 25, L('超出范围的温度不应该被设置', 'An out-of-range temperature must not be applied'))
        ctx.includes(r.output, L('16~30', '16 to 30'), L('模型应该把可设置的范围告诉用户', 'The model should tell the user the allowed range'))
      },
    },
  ],
}
