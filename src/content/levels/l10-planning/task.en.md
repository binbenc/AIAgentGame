## Task

Create `planner.ts`, implementing Plan-and-Execute:

```ts
planAndExecute(goal: string, tools: Tool[], opts?: PlanOptions): Promise<{ plan, stepResults, output }>
```

1. **Plan**: `makePlan(request, tools)` makes one `chat()` call (**without `tools`**; list the tools in the system prompt instead) and asks the model for a JSON plan only: `{"steps": [{"id": 1, "task": "..."}]}`. Parse it with `parseJsonLoose` from level 2 and validate it with `PlanSchema` (zod). If it's invalid, retry `planRetries` times (default 1) with the validation error (naming the field); if it still fails, throw.
2. **Execute**: run the steps in order, one `runAgent(prompt, tools, { system: EXECUTOR_SYSTEM })` per step. `prompt` is a **brand-new conversation** containing only:
   - the user's original request;
   - the **results** of earlier steps (`runAgent`'s `output`, not the full `messages`);
   - what this step should do, marked with `Current step:`.
3. **Replan**: when a step fails (`stopReason` isn't `'done'`, or the output contains "Step failed"), record it as `ok: false`, then call `makePlan` with the **failure reason** to replan the remaining work, and replace the steps that haven't run yet with the new ones. Replan at most `maxReplans` times (default 1).
4. **Synthesize**: finish with one `chat({ system: SYNTH_SYSTEM, ... })` that gets the original request and every step's result, and writes the final reply.

Return value: `plan` is the steps actually executed, `stepResults` has one `{ id, task, ok, output }` per step, and `output` is the synthesized reply.

## Scenarios
- Plan first, then execute in order: a request with 4 asks, each of which must be answered in the final reply
- Pass only results between steps: later steps use what earlier steps found instead of looking it up again
- Step fails → replan with the failure reason
- Invalid plan format → validate, feed back, retry
