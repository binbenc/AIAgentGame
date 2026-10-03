## 任务

在 `agent.ts` 中实现 Agent 主循环：

```ts
runAgent(task: string | Message[], tools: Tool[], opts?: AgentOptions): Promise<AgentResult>
```

- `task` 是字符串时，作为第一条 user 消息；是数组时，作为已有的对话历史（后面的关卡会用到）。
- 每一步：调用 `chat({ system, model, tools: tools.map(t => t.spec), messages })`，把响应作为 assistant 消息追加进 `messages`。
- `stop_reason !== 'tool_use'`：结束，返回 `{ output: 文本, steps, messages, stopReason: 'done' }`。
- 否则：按 `name` 找到对应工具并执行。**同一个响应里的多个 `tool_use` 要并行执行**，所有结果放进**同一条** user 消息里。
- `steps` 等于调用模型的次数；超过 `maxSteps`（默认 10）时停止，返回 `stopReason: 'max_steps'`。

可以直接复用 `tools.ts` 里的 `Tool`、`textOf`、`toToolContent`。

## 判题场景
- 多步推理：邮箱 → 客户 → 订单 → 物流
- 并行工具调用
- 失控保护：模型一直想调用工具时，要按 `maxSteps` 停下
- 直接回答：不需要工具时，一步结束
