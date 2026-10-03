## 任务

新建 `mcp.ts`。协议版本用 `"2025-06-18"`，消息都是 JSON-RPC 2.0 对象：

- 请求 `{ jsonrpc: "2.0", id, method, params? }` → 响应 `{ jsonrpc: "2.0", id（原样回传）, result }` 或 `{ jsonrpc: "2.0", id, error: { code, message } }`
- 通知 `{ jsonrpc: "2.0", method, params? }`：**没有 id，永远不回复**

传输层 `Transport` 已经由环境提供：`send(message)` 发给对端，`onMessage(handler)` 接收对端消息。

### 1. 服务端：`createMcpServer({ name, version, tools })`
返回 `{ handle(message) → Promise<响应 | null>, connect(transport) }`（`connect` 已写好）。`handle` 要支持：

| 方法 | 结果 |
|---|---|
| `initialize` | `{ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } }`。版本协商：客户端要求的版本在 `SUPPORTED_VERSIONS` 里就原样返回，否则返回 `PROTOCOL_VERSION` |
| `ping` | `{}` |
| `tools/list` | `{ tools: [{ name, description, inputSchema }] }`（注意 MCP 用驼峰 `inputSchema`） |
| `tools/call` | `params = { name, arguments }`，返回 `{ content: [{ type: "text", text }], isError }` |
| 其它方法 | 错误 `-32601`（Method not found） |

- 工具**不存在**：协议错误 `-32602`（Invalid params）。
- 工具**执行时抛异常**：不是协议错误，返回正常的 `result`，`isError: true`，错误信息放进 `content`。
- 通知、以及收到的响应：返回 `null`。

`createOrderMcpServer(api)` 已写好：用你第 5 关的 `createOrderTools` 创建名为 `nova-orders` 的服务器。

### 2. 客户端：`connectMcp(transport)`
1. 请求 id 自增，用 `Map` 记录等待中的请求；响应可能**乱序**到达，要按 id 分发。收到 `error` 时 reject。
2. 握手：发送 `initialize`（`protocolVersion`、`capabilities: {}`、`clientInfo: { name, version }`）→ **等响应回来** → 发送通知 `notifications/initialized`。
3. 返回 `{ protocolVersion, serverInfo, capabilities, listTools(), callTool(name, args) }`。`tools/list` 是分页的：响应里有 `nextCursor` 时，用 `{ cursor }` 继续请求下一页。

### 3. 适配：`mcpToolsToAgentTools(client, prefix)`
把每个 MCP 工具转成工作区的 `Tool`：
- 名字：`${prefix}__${原名}`，把不符合 `[a-zA-Z0-9_-]` 的字符替换成 `_`，截断到 64 个字符（模型 API 的限制；MCP 允许 `.` 等字符）。
- `input_schema` 取自 `inputSchema`，`description` 保留。
- `run`：用**原始名字** `callTool`，把 `content` 里的文本拼起来返回；`isError` 为真时 `throw`，Agent 会把它转成 `is_error` 的 tool_result。

## 判题场景
- 服务端协议一致性：信封格式、id 回传、版本协商、通知不回复、错误码
- 客户端：握手顺序、分页、并发请求乱序返回、错误响应
- 适配器：前缀、字符替换、64 字符截断、isError → is_error
- 一个 Agent 同时使用两个 MCP 服务器（你的订单服务器 + 设备服务器）
- 设备工具出错时，模型能看到错误并给出解释
