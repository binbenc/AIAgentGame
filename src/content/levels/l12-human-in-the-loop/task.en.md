## Task

Create `approval.ts` and implement an agent that can pause and wait for human approval. The tool type is extended to `ApprovalTool = Tool & { requiresApproval?: boolean }`.

### `runWithApproval(task, tools, opts)`

Runs the loop like `runAgent`, but when the model calls a tool with `requiresApproval: true`:

- **Don't run it.** Other, safe tools in the same turn still run as usual (use `executeToolCalls` from `agent.ts`).
- Return `{ status: 'needs_approval', pending: { toolUseId, name, input }, state }`.

`state` must be **plain JSON data**: it must still resume correctly after `JSON.parse(JSON.stringify(state))`. At a minimum it holds the conversation `messages`, the number of steps taken, the tool results already produced this turn, and the calls still waiting.

If no dangerous tool is called, run to completion and return `{ status: 'done', output, state }`.

### `resumeWithApproval(state, decision, tools, opts)`

- `decision.approve === true`: run the tool (exactly once).
- `decision.approve === false`: **don't run it**. Fill in an `is_error: true` tool_result whose content is `Rejected by human reviewer: <note>`, and let the model explain to the user.
- All of this turn's `tool_result`s go into **one** user message (in tool_use order), then the loop continues.

## Test scenarios
- Dangerous action: pause for approval, safe tools still run, state is serializable
- Approve: resume from state after a JSON round trip; the refund runs exactly once
- Reject: the refund doesn't run, and the model tells the user honestly
- Safe actions: run to completion without asking for approval
