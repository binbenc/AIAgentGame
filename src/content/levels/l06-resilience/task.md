## 任务一：`resilience.ts`

```ts
withRetry(fn, { retries = 3, baseDelayMs = 500, maxDelayMs = 8000 })
withTimeout(promise, ms, label)
```

- `withRetry`：只有在 `isRetryable(e)` 为真时才重试（`LLMError` 并且 `e.retryable === true`，例如 429、5xx、网络错误）。第 i 次重试前等待 `min(maxDelayMs, baseDelayMs × 2^i) + 随机抖动(0 ~ baseDelayMs)`。等待**必须**使用 `agent-quest` 的 `sleep()`。
- `withTimeout`：超时后抛出错误，错误信息里要包含“超时”。

## 任务二：加固 `agent.ts`

`AgentOptions` 新增 `retries?`（默认 3）和 `toolTimeoutMs?`（默认 10000）。

1. 每次 `chat()` 都用 `withRetry` 包起来。
2. 模型调用了**不存在的工具**：返回 `is_error` 结果，内容要列出可用的工具名。
3. **参数不合法**（不是对象，或者缺少 schema 里的 `required` 字段）：返回 `is_error` 结果，内容说明哪里不对，**不要去执行工具**。
4. 工具执行用 `withTimeout` 包起来，超时也返回 `is_error`。

## 判题场景
限流重试 · 不可重试的错误 · 重试耗尽 · 幻觉工具 · 坏参数 · 慢工具
