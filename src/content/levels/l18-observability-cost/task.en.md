## Part 1: update `agent.ts` (dependency injection)

Add an optional field `chat?: (req: ChatRequest) => Promise<ChatResponse>` to `AgentOptions`. If it's passed, use it to call the model; otherwise use `chat` from `agent-quest`. Everything else **stays the same** — every earlier level is regression-tested against this `agent.ts`.

## Part 2: `observability.ts`

### Pricing and tracing
Price table `PRICES` (USD per million tokens, billed by the `model` in the response):

| model | input | output |
|---|---|---|
| `mock-default` | $3 | $15 |
| `mock-fast` | $1 | $5 |

- `costOf(model, usage)`: `(input tokens × input price + output tokens × output price) / 1_000_000`.
- `instrument(chatFn, tracer, { feature })`: returns a wrapped chat function that records one span per call: `{ feature, model, latencyMs, inputTokens, outputTokens, costUsd, error? }`. Time it with `now()` from `agent-quest`. Failed calls get a span too (0 tokens and 0 cost, with `error` set to the message), and then **the error is re-thrown**.
- `summarize(spans)`: group by `feature` into `{ calls, errors, inputTokens, outputTokens, costUsd, p50LatencyMs, p95LatencyMs }`. Percentiles use the nearest-rank method: sort ascending and take item number `ceil(p/100 × n)` (counting from 1).

### Response cache
- `stableKey(value)`: stable serialization. Object keys are sorted (skipping `undefined`), arrays keep their order.
- `withCache(chatFn, store?)`: key is `stableKey(req)`; on a hit, return the cached response without calling the model; **failed results are not cached**.

### Model routing
`routeModel(question)`: return `'fast'` for simple FAQs and `'default'` for questions that need data lookups or multiple steps. Zero-cost rules are enough (length, order ids, emails, keywords like "help me / cancel / refund / then").

### Budget guard
`withBudget(chatFn, { maxUsd })`: the returned function has a `spent()` method. **Before each call**, estimate `spent so far + this call's input cost` (input tokens from `countTokens(req)`, priced by `req.model` tier: `fast` → `mock-fast`, anything else → `mock-default`). If that exceeds `maxUsd`, throw a `BudgetExceededError` whose message contains the word "budget". After a successful call, add the actual cost.

### Put it together: `createSupportBot(tools, { maxUsd? })`
Returns `{ tracer, answer(question, feature), report(), spent() }`. `answer` picks the model with `routeModel` and injects `withCache(instrument(withBudget(chat), tracer, { feature }), cache)` into `runAgent` through `opts.chat`. The cache is the outermost layer: a cache hit makes no model call, records no span and spends no budget.

## Test scenarios
- Pricing, tracing and summaries (unit tests)
- `runAgent` accepts an injected `chat` and behaves exactly as before without one
- Per-feature attribution + model routing: spans line up one-to-one with the bill (trace)
- Response cache: the same FAQ calls the model only once
- Budget guard: a runaway loop is stopped **before** it goes over budget
