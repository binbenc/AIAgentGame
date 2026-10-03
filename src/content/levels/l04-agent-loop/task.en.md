## Task

Implement the agent's main loop in `agent.ts`:

```ts
runAgent(task: string | Message[], tools: Tool[], opts?: AgentOptions): Promise<AgentResult>
```

- If `task` is a string, it becomes the first user message; if it's an array, it's an existing conversation history (later levels use this).
- Each step: call `chat({ system, model, tools: tools.map(t => t.spec), messages })` and append the response to `messages` as an assistant message.
- `stop_reason !== 'tool_use'`: you're done; return `{ output: text, steps, messages, stopReason: 'done' }`.
- Otherwise: find each tool by `name` and run it. **Multiple `tool_use` blocks in one response run in parallel**, and all their results go into **one** user message.
- `steps` is the number of model calls; once `maxSteps` (default 10) is exceeded, stop and return `stopReason: 'max_steps'`.

You can reuse `Tool`, `textOf` and `toToolContent` from `tools.ts`.

## Test scenarios
- Multi-step reasoning: email → customer → orders → shipping
- Parallel tool calls
- Runaway protection: when the model keeps asking for tools, stop at `maxSteps`
- Direct answer: when no tool is needed, finish in one step
