# 从你的 Agent 迁移到主流 SDK

你在游戏里**手写**了 Agent 的每个部件。框架做的事并不神秘，下面这张表把你写的代码和各 SDK 的对应概念对应起来：

| 你写的（src/） | Claude API Tool Runner | Claude Agent SDK | OpenAI Agents SDK | LangGraph.js |
|---|---|---|---|---|
| `chat()`（agent-quest 门面） | `client.messages.create` | 内置 | 内置 | `ChatAnthropic` / `ChatOpenAI` |
| `Tool { spec, run }`（tools.ts） | `betaZodTool({ name, inputSchema, run })` | `tool(name, desc, zodShape, handler)` | `tool({ name, parameters, execute })` | `tool(fn, { name, schema })` |
| `runAgent` 循环（agent.ts） | `client.beta.messages.toolRunner` | `query()` | `run(agent, input)` | `createReactAgent` |
| `maxSteps` | `max_iterations` | `maxTurns` | `maxTurns` | `recursionLimit` |
| `executeToolCalls` 错误 → `is_error` | 抛错自动转换 | 返回 `isError: true` | 抛错自动转换 | `ToolMessage` 带 error |
| 人工审批（approval.ts） | 在 `run` 里拦截 | `canUseTool` / hooks | `needsApproval` + interruptions | `interrupt()` |
| MCP（mcp.ts） | MCP connector | `mcpServers` | `MCPServerStdio` 等 | `@langchain/mcp-adapters` |
| 可观测性（observability.ts） | `usage` 字段 | 结果消息中的用量/费用 | Tracing | LangSmith |

迁移建议：

1. **保留你的判题场景**（`tests/`）。换框架之前先跑一遍，换完再跑一遍，这就是你的回归 eval。
2. 先从 `agent-quest` 的 `chat()` 换到官方 SDK 的 `messages.create`（很薄的一层），其它代码不用动。
3. 只有当框架提供的能力（会话持久化、内置工具、托管运行时、可视化 trace）确实比你自己的实现更省事时，再整体迁移。

本目录下的示例**不参与编译和测试**（没有安装对应依赖），只用来对照阅读。API 以各 SDK 的官方文档为准：

- Claude API Tool Runner：https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
- Claude Agent SDK：https://code.claude.com/docs/en/agent-sdk/typescript
- OpenAI Agents SDK (JS)：https://openai.github.io/openai-agents-js/
- LangGraph.js：https://langchain-ai.github.io/langgraphjs/
- MCP TypeScript SDK：https://github.com/modelcontextprotocol/typescript-sdk
