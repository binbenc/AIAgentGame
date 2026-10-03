## Production notes

- **Separate retryable from non-retryable errors**: 429, 5xx, 529 (overloaded) and network timeouts are worth retrying; 400, 401, 403 and 404 will fail no matter how many times you retry, and only waste time and money.
- **Exponential backoff + jitter**: jitter keeps a crowd of clients from all retrying at the same instant (the thundering herd). If the server sends a `retry-after` header, honor it first.
- The official SDKs retry on their own (Anthropic / OpenAI retry twice by default). **Know which layer is retrying**, or you end up with 3 SDK retries × 3 retries in your code = 9× amplification.
- Hallucinated tools and bad arguments are **model-level errors**: feed them back to the model as `is_error` results so it can correct itself, instead of crashing the program. Turning on `strict` tool mode cuts bad arguments dramatically.
- Every external call needs a timeout, and so does the agent run as a whole.
- Before retrying a tool with side effects, make sure it's **idempotent**, e.g. with an idempotency key, so you never charge or ship twice.
- Circuit breaker: when a dependency keeps failing, stop calling it for a while and return a degraded result right away.
