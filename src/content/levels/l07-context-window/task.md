## 任务

新建 `session.ts`，实现一个能自动压缩历史的多轮会话：

```ts
class ChatSession {
  constructor(opts: { system?: string; maxContextTokens: number; keepLastTurns?: number; tools?: Tool[] })
  messages: Message[]
  send(userText: string): Promise<string>
}
splitForCompaction(messages, keepLastTurns) → { older, recent }
```

1. **`splitForCompaction`（纯函数）**：按“轮”切分。一轮从一条**用户发言**开始（`role === 'user'` 且不是 `tool_result` 消息），包含这之后的 assistant 回复、工具调用和工具结果。最近 `keepLastTurns` 轮放进 `recent`，更早的放进 `older`；轮数不够时 `older` 为空。只能在轮的边界切，`older + recent` 必须正好等于原数组。
2. **`summarize(older)`**：单独调用一次 `chat()` 做摘要。system 要写明这是**摘要**任务，并要求保留姓名、订单号、时间偏好等关键事实；用户消息里放 `renderTranscript(older)`（已提供）。
3. **`send(userText)`**：
   - 先把用户消息 push 进 `messages`；
   - 用 `countTokens({ system, messages, tools })` 计算下一次请求的大小（**tools 也占 token**）；
   - 超过 `maxContextTokens` 时压缩：`messages = [{ role: 'user', content: '[对话摘要] ' + 摘要 }, ...recent]`。压缩后还超，就少保留一轮再压；
   - 然后调用 `runAgent(this.messages, tools, { system })`（来自 `agent.ts`），用返回的 `messages` 更新历史，返回 `output`。
4. 没超预算时**不要**做摘要——每次摘要都是一次额外的模型调用。

## 判题场景
- 按轮切分（单元测试）：带工具往返的历史，不能留下孤立的 `tool_result`
- 短对话不压缩：3 轮对话，只调用 3 次模型
- 长对话：26 轮，中途还查过一次物流；每次请求都不超过预算，最后还能答出第 1 轮说过的姓名、订单号和收货时间；总 token 要明显少于不压缩的做法
