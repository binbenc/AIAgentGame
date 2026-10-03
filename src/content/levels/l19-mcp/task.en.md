## Task

Create `mcp.ts`. Use protocol version `"2025-06-18"`. Every message is a JSON-RPC 2.0 object:

- Request `{ jsonrpc: "2.0", id, method, params? }` → response `{ jsonrpc: "2.0", id (echoed back), result }` or `{ jsonrpc: "2.0", id, error: { code, message } }`
- Notification `{ jsonrpc: "2.0", method, params? }`: **no id, never answered**

The environment provides the `Transport`: `send(message)` sends to the other side, `onMessage(handler)` receives from it.

### 1. Server: `createMcpServer({ name, version, tools })`
Returns `{ handle(message) → Promise<response | null>, connect(transport) }` (`connect` is already written). `handle` must support:

| Method | Result |
|---|---|
| `initialize` | `{ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } }`. Version negotiation: if the client's requested version is in `SUPPORTED_VERSIONS`, echo it back; otherwise return `PROTOCOL_VERSION` |
| `ping` | `{}` |
| `tools/list` | `{ tools: [{ name, description, inputSchema }] }` (note that MCP uses camelCase `inputSchema`) |
| `tools/call` | `params = { name, arguments }`, returns `{ content: [{ type: "text", text }], isError }` |
| Anything else | error `-32601` (Method not found) |

- **Unknown tool**: protocol error `-32602` (Invalid params).
- **Tool throws while running**: not a protocol error. Return a normal `result` with `isError: true` and the error message in `content`.
- Notifications, and any responses you receive: return `null`.

`createOrderMcpServer(api)` is already written: it creates a server named `nova-orders` from your Level 5 `createOrderTools`.

### 2. Client: `connectMcp(transport)`
1. Request ids auto-increment, and a `Map` tracks pending requests. Responses may arrive **out of order**, so dispatch by id. Reject when you get an `error`.
2. Handshake: send `initialize` (`protocolVersion`, `capabilities: {}`, `clientInfo: { name, version }`) → **wait for the response** → send the `notifications/initialized` notification.
3. Return `{ protocolVersion, serverInfo, capabilities, listTools(), callTool(name, args) }`. `tools/list` is paginated: when a response has `nextCursor`, request the next page with `{ cursor }`.

### 3. Adapter: `mcpToolsToAgentTools(client, prefix)`
Turn each MCP tool into a workspace `Tool`:
- Name: `${prefix}__${original name}`, with any character outside `[a-zA-Z0-9_-]` replaced by `_`, truncated to 64 characters (a model API limit; MCP allows characters like `.`).
- `input_schema` comes from `inputSchema`; keep `description`.
- `run`: `callTool` with the **original name**, join the text in `content` and return it; if `isError` is true, `throw` — the agent turns that into an `is_error` tool_result.

## Test scenarios
- Server protocol conformance: envelope format, echoing ids, version negotiation, no replies to notifications, error codes
- Client: handshake order, pagination, concurrent requests answered out of order, error responses
- Adapter: prefix, character replacement, 64-character truncation, isError → is_error
- One agent using two MCP servers at once (your order server + the device server)
- When a device tool fails, the model sees the error and explains it
