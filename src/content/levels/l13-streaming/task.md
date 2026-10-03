## 任务

新建 `streaming.ts`。

### 1. `streamAnswer(question, onText, opts?)`

```ts
streamAnswer(question: string, onText: (delta: string) => void, opts?: { signal?: AbortSignal; firstTokenTimeoutMs?: number })
  → Promise<{ text: string; cancelled: boolean; timedOut?: boolean }>
```

- 用 `chatStream(req, { signal })` 发起流式请求，`for await` 逐个处理事件：收到 `text_delta` 就**立刻**调用 `onText(delta)`。
- **取消**：调用方 abort 了 `opts.signal` 时，要真正中止请求（`signal` 必须传给 `chatStream`）。流会抛出 `AbortError`：捕获它，返回已经生成的部分，`cancelled: true`。
- **首字超时**：设置了 `firstTokenTimeoutMs` 时，如果到点还没收到第一个 `text_delta`，就中止请求，返回 `timedOut: true`。计时用 `agent-quest` 的 `sleep(ms, signal)`；**收到首字后要取消计时器**。
- 正常结束返回 `{ text, cancelled: false }`。

### 2. `streamAgent(task, tools, { onText, onStatus }, opts?)`

流式版的 Agent 循环：每一轮都用 `chatStream`；`text_delta` 转给 `onText`；收到 `tool_use_start` 时调用 `onStatus("正在调用工具 <name>…")`。一轮的事件迭代完后，用 `await stream.finalResponse()` 拿到完整响应，接下来和 `runAgent` 一样执行工具（可以复用 `executeToolCalls`）、继续循环。返回 `{ output, messages }`。

## 判题场景
- 边生成边显示：onText 被调用多次，拼起来等于完整回答
- 用户点了“停止生成”：立刻停止推送，返回已生成的部分，请求被真正中止
- 首字超时：迟迟不出字就中止；正常请求不受影响
- 流式 Agent：调用工具时推送进度
