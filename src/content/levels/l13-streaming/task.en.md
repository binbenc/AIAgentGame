## Task

Create `streaming.ts`.

### 1. `streamAnswer(question, onText, opts?)`

```ts
streamAnswer(question: string, onText: (delta: string) => void, opts?: { signal?: AbortSignal; firstTokenTimeoutMs?: number })
  → Promise<{ text: string; cancelled: boolean; timedOut?: boolean }>
```

- Start a streaming request with `chatStream(req, { signal })` and handle the events one by one with `for await`: on each `text_delta`, call `onText(delta)` **right away**.
- **Cancellation**: when the caller aborts `opts.signal`, really abort the request (the `signal` must be passed to `chatStream`). The stream throws an `AbortError`: catch it and return what has been generated so far with `cancelled: true`.
- **First-token timeout**: when `firstTokenTimeoutMs` is set and no `text_delta` has arrived by then, abort the request and return `timedOut: true`. Time it with `sleep(ms, signal)` from `agent-quest`; **cancel the timer once the first token arrives**.
- On normal completion, return `{ text, cancelled: false }`.

### 2. `streamAgent(task, tools, { onText, onStatus }, opts?)`

A streaming version of the agent loop: use `chatStream` for every turn; forward `text_delta` to `onText`; on `tool_use_start`, call `onStatus("Calling tool <name>…")`. Once a turn's events are consumed, get the full response with `await stream.finalResponse()`, then run the tools like `runAgent` does (you can reuse `executeToolCalls`) and keep looping. Return `{ output, messages }`.

## Test scenarios
- Show text as it's generated: onText is called many times, and the pieces add up to the full answer
- The user hits "Stop generating": stop pushing text immediately, return the partial answer, and really abort the request
- First-token timeout: abort when no token arrives in time; normal requests are unaffected
- Streaming agent: push progress updates while calling tools
