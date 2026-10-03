## Part 1: `resilience.ts`

```ts
withRetry(fn, { retries = 3, baseDelayMs = 500, maxDelayMs = 8000 })
withTimeout(promise, ms, label)
```

- `withRetry`: retry only when `isRetryable(e)` is true (an `LLMError` with `e.retryable === true`, e.g. 429, 5xx, network errors). Before retry i, wait `min(maxDelayMs, baseDelayMs × 2^i) + random jitter (0 ~ baseDelayMs)`. The wait **must** use `sleep()` from `agent-quest`.
- `withTimeout`: on timeout, throw an error whose message contains "timed out".

## Part 2: harden `agent.ts`

Add `retries?` (default 3) and `toolTimeoutMs?` (default 10000) to `AgentOptions`.

1. Wrap every `chat()` call in `withRetry`.
2. The model calls a **tool that doesn't exist**: return an `is_error` result that lists the available tool names.
3. **Invalid arguments** (not an object, or missing a `required` field from the schema): return an `is_error` result explaining what's wrong, and **don't run the tool**.
4. Wrap tool execution in `withTimeout`; a timeout also becomes an `is_error` result.

## Scenarios
Rate-limit retry · Non-retryable error · Retries exhausted · Hallucinated tool · Bad arguments · Slow tool
