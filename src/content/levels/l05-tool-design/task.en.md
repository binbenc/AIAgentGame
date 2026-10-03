## Part 1: design the order tools in `toolkit.ts`

Implement `createOrderTools(api)`, returning 3 tools that wrap `api.searchOrders`, `api.cancelOrder` and `api.refundPolicy`:

- Tool names are snake_case verb phrases; each description is at least 20 characters and says clearly **what the tool does and when to use it**.
- **Every parameter has a description.**
- The order search tool: an email parameter, plus an optional `status` parameter that is an enum of `pending | shipped | delivered | cancelled`.
- The cancel tool: the description of the order id parameter states its format (e.g. `NV-100001`); there's also a required cancellation reason parameter.
- Keep the search tool's results **lean**: only `id / createdAt / product / amount / status`, with every internal field starting with `_` removed.

## Part 2: update `agent.ts`

When a tool throws, the agent must not crash. Return `{ type: 'tool_result', tool_use_id, content: error message, is_error: true }` and let the model deal with it.

## Test scenarios
- Tool convention checks
- Search by status: only shipped orders come back
- Successful cancellation
- Failed cancellation: degrade gracefully when the tool fails
