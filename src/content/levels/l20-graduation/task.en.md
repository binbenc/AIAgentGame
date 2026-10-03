## Task

In `app.ts`, implement `createSupportAgent(deps)`, which returns `{ tracer, handle(userId, message) }`. `handle` is the entry point for every live user message and returns `{ reply, model, costUsd, handedOff }`.

Assembly order (each step reuses a module you've already written):

1. **Model routing**: `routeModel(message)` (L18) decides between `fast` and `default`.
2. **Tools**:
   - `createOrderTools(deps.orders)` (L5). Wrap the **cancel order** tool with `requireApproval`: before running, call `deps.approve({ tool, input })`; if it returns `false`, **don't run it** and throw an error (the agent loop turns it into `is_error`).
   - `helpCenterTool(deps.kb)`: named `search_help_center`, it searches with `kb.search(query, 3)` (L9) and returns each chunk's `[chunk id]` and text. It returns external content edited by the ops team, so wrap it with `untrustedTool` (L17).
   - `createMemoryTools(deps.memory, userId)` (L8).
3. **System prompt**: `SUPPORT_SYSTEM` + `UNTRUSTED_POLICY` (L17), then use `buildSystemWithMemories` (L8) to inject the memories from `memory.recall(userId, message, 3)`. `SUPPORT_SYSTEM` must ask the model to cite help-center content as `[chunk id]`.
4. **Model call chain**: `instrument(withBudget(chat, { maxUsd }), tracer, { feature: 'support' })` (L18), injected via `runAgent(..., { chat })`.
5. **Run**: `runAgent` (L4–L6, with retries, timeouts and bad-argument handling built in), `maxSteps: 8`.
6. **Fallback**: if the budget is exceeded (`BudgetExceededError`) or the steps run out, **don't throw** — return `HANDOFF_REPLY` with `handedOff: true`.
7. **Output filtering**: the final reply goes through `redactSecrets` (L17).
8. `costUsd` = the total cost of all spans produced by this message.

## Test scenarios (simulated live traffic)
FAQ with citations · personalization from memory · cancellation needs approval (approved / rejected) · poisoned help-center doc · privacy masking · recovering from rate limits · budget fallback
