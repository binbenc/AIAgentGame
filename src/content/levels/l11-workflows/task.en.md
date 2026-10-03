## Task

Create `workflows.ts` and implement three common workflow patterns (the prompt constants are already written).

### 1. Routing

- `classifyTicket(text)`: call `chat` once, **with `model: 'fast'`**, and have the model output only a category name. `trim()` + `toLowerCase()` the output, then validate it with `RouteSchema` (a zod enum). Anything outside the enum falls back to `'other'`.
- `routeTicket(text, api)`: classify first, then dispatch to a handler and return `{ route, reply }`:
  - `order_status`: pull the order number out of the text, call `api.getShipping(id)`, and build the reply from a template. **No model call.**
  - `refund`: return the content of `api.refundPolicy()` directly. **No model call.**
  - `tech_support`: an open-ended question; call the model once with `TECH_SYSTEM`.
  - `complaint` / `other`: a canned reply that hands off to a human.

### 2. Prompt chaining

`draftReply(ticket)`: extract → gate → draft → gate → polish. Returns `{ ok: true, reply }` or `{ ok: false, reason }`.

1. Extract: `EXTRACT_SYSTEM`, validated with `parseJsonLoose` + `ExtractSchema`.
2. **Gate 1**: no order number → return `ok: false` immediately. None of the later steps run.
3. Draft: `DRAFT_SYSTEM`.
4. **Gate 2** (plain code): the draft must contain the order number and must not contain any word in `FORBIDDEN`; otherwise return `ok: false`.
5. Polish: `POLISH_SYSTEM`. Give the model the customer's sentiment and the full draft.

### 3. Parallelization

`moderate(text)`: call the model **separately** for each item in `CHECKS` (`model: 'fast'`, answer only YES / NO), and **send all three at once** with `Promise.all`. Put the names of checks that answered YES into `flags`; `allowed = flags.length === 0`.

## Test scenarios
- Routing: fast-model classification; order tracking / return policy without another model call
- Routing: open questions go to the model; categories outside the enum fall back to other
- Prompt chain: extract → draft → polish
- Gates: stop early when the order number is missing or the draft overpromises
- Parallel: three moderation checks run at once, taking about as long as the slowest one
