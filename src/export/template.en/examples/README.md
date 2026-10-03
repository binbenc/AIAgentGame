# Moving your agent to a mainstream SDK

In the game you wrote every part of the agent **by hand**. Frameworks don't do anything magical; this table maps the code you wrote to the matching concept in each SDK:

| What you wrote (src/) | Claude API Tool Runner | Claude Agent SDK | OpenAI Agents SDK | LangGraph.js |
|---|---|---|---|---|
| `chat()` (agent-quest facade) | `client.messages.create` | built in | built in | `ChatAnthropic` / `ChatOpenAI` |
| `Tool { spec, run }` (tools.ts) | `betaZodTool({ name, inputSchema, run })` | `tool(name, desc, zodShape, handler)` | `tool({ name, parameters, execute })` | `tool(fn, { name, schema })` |
| `runAgent` loop (agent.ts) | `client.beta.messages.toolRunner` | `query()` | `run(agent, input)` | `createReactAgent` |
| `maxSteps` | `max_iterations` | `maxTurns` | `maxTurns` | `recursionLimit` |
| `executeToolCalls` errors → `is_error` | thrown errors converted automatically | return `isError: true` | thrown errors converted automatically | `ToolMessage` with error |
| Human approval (approval.ts) | intercept inside `run` | `canUseTool` / hooks | `needsApproval` + interruptions | `interrupt()` |
| MCP (mcp.ts) | MCP connector | `mcpServers` | `MCPServerStdio` etc. | `@langchain/mcp-adapters` |
| Observability (observability.ts) | `usage` field | usage/cost in the result message | Tracing | LangSmith |

Migration tips:

1. **Keep your grading scenarios** (`tests/`). Run them before switching frameworks and again after; that's your regression eval.
2. Start by swapping `agent-quest`'s `chat()` for the official SDK's `messages.create` (a thin layer); the rest of your code stays the same.
3. Migrate wholesale only when a framework feature (session persistence, built-in tools, a hosted runtime, visual traces) is genuinely less work than your own implementation.

The examples in this folder are **not compiled or tested** (their dependencies aren't installed); they're for side-by-side reading only. Each SDK's official docs are authoritative on the API:

- Claude API Tool Runner: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/typescript
- OpenAI Agents SDK (JS): https://openai.github.io/openai-agents-js/
- LangGraph.js: https://langchain-ai.github.io/langgraphjs/
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
