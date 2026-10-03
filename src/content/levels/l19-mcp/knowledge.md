## 生产落地要点

- **为什么是 MCP**：没有标准时，M 个 AI 应用接 N 个工具系统要写 M×N 份集成；MCP 把它变成 M+N。除了本关的 **tools**，协议还定义了 **resources**（可读取的上下文数据）和 **prompts**（可复用的提示模板），以及客户端提供给服务端的 sampling、elicitation 等能力。
- **别手写协议**：生产上用官方 SDK——TypeScript 的 `@modelcontextprotocol/sdk`（`McpServer` / `Client`）、Python 的 `mcp`（含 FastMCP）。手写一遍是为了理解报文长什么样，排查问题时你会感谢自己。
- **传输层**：本地进程用 **stdio**（客户端拉起子进程，经 stdin/stdout 交换消息）；远程服务用 **Streamable HTTP**（一个 HTTP 端点，可以按需升级成 SSE 流式返回，取代了旧的 HTTP+SSE 传输）。协议层和传输层是解耦的，所以本关的内存传输也能跑通。
- **认证**：远程 MCP 服务器使用 **OAuth 2.1**（授权码 + PKCE），服务器作为资源服务器校验 token。不要把长期有效的 API key 写进客户端配置，也不要把用户 token 透传给下游服务。
- **信任边界**：第三方服务器是不可信的。**工具描述本身就是注入面**（“tool poisoning”：在 description 里藏指令）；服务器还可能在你批准之后悄悄修改工具定义（“rug pull”）。要做服务器白名单、固定版本、审查工具描述的变更，并把返回内容当作不可信数据处理（第 17 关）。
- **命名冲突**：多个服务器都可能有 `search`、`get_status` 这样的工具。加服务器前缀是常见做法（Claude Code 用的是 `mcp__服务器名__工具名`）；工具很多时，按任务动态挑选工具，或者使用 tool search。
- **错误的两个层次**：协议错误（未知方法、未知工具、参数格式错误）走 JSON-RPC `error`；工具执行失败走 `result.isError: true`，让模型看到错误并自行调整。混用的话，模型要么看不到错误，要么整个调用链崩掉。
- **Anthropic API 的 MCP connector** 可以让 Messages API 直接连接远程 MCP 服务器，省掉自己写客户端；但你仍然要对服务器的可信度负责。
