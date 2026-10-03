## Task

Create `agents/orchestrator.ts` and implement the orchestrator-workers pattern:

```ts
research(question: string, toolsets: Record<string, Tool[]>): Promise<ResearchReport>
// ResearchReport = { answer, subtasks, workers: WorkerReport[], partial }
// WorkerReport   = { id, goal, ok, summary, error? }
```

`toolsets` groups the tools by data source: `web` (web_search), `specs` (get_spec_sheet), `reviews` (get_reviews). All of them return long raw data.

1. **`plan(question, toolsets)`**: call the model once (without tools). In the request, **list the available toolset names and tool descriptions**, and ask for JSON only:
   `{"subtasks":[{"id":"...","goal":"...","toolset":"web | specs | reviews"}]}`.
   Validate with `parseJsonLoose` (`../structured`) + `PlanSchema`, and check that each `toolset` actually exists.
2. **`runWorker(subtask, tools)`**: one **brand-new** `runAgent` (`../agent`) per subtask:
   - pass the task as a string (containing the `goal`); don't reuse anyone else's `messages`;
   - give it only that one toolset, `toolsets[subtask.toolset]`;
   - the worker's system prompt must ask it to **return only a concise summary of the key points**, not paste raw data;
   - on error (or if it doesn't finish normally), **don't throw**; return `{ ok: false, summary: '', error }`.
3. Run all workers **in parallel** with `Promise.all`.
4. **`synthesize(question, workers)`**: call the model once more, with **only each worker's summary** in the message. For failed subtasks, write `Subtask <id> failed: <reason>` so the brief can flag "data missing".
5. Return `partial = whether any worker failed`. If every worker fails, you may just throw.

## Test scenarios
- Orchestrate → parallel workers → synthesize: each worker gets only its own toolset; workers start at the same time; the brief covers every subtask
- Context isolation + summaries only: workers can't see each other's data; the synthesis request contains no raw data and is far smaller than the raw text
- Decompose based on the question: when the question asks only about price and reviews, don't look up specs
- One worker fails: the others finish as usual, `partial: true`, and the brief flags the missing data
