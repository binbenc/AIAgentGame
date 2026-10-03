## Task

Create `refine.ts` and implement an evaluator-optimizer loop:

```ts
writeWithReview(brief: string, opts: { rubric: string[]; maxRounds?: number }): Promise<RefineResult>
// RefineResult = { final, passed, rounds, history: { draft, verdict }[] }
// verdict      = { pass: boolean, score: 0~10, feedback: string[] }
```

1. **`generate(brief, previous?)`**: the generator. The first draft sees only the brief; when revising, the user message must include **the brief + the previous draft + every piece of reviewer feedback**.
2. **`evaluate(draft, rubric)`**: the evaluator.
   - Use a **separate system prompt** (a reviewer role, not shared with the generator).
   - In the user message, **list every rubric item**, and put the draft inside `<draft>...</draft>` tags.
   - Ask for JSON only, `{"pass", "score", "feedback"}`, and validate it with `parseJsonLoose` (`./structured`) + `VerdictSchema`.
   - If parsing or validation fails, feed the error back to the evaluator and **retry once**; if it still fails, throw. **Output that can't be parsed must never count as a pass.**
3. **`writeWithReview`**: loop for at most `maxRounds` rounds (default 3): generate → evaluate → append to `history`.
   - Stop as soon as a draft passes, and return that draft.
   - If it still hasn't passed at the limit: `passed: false`, and `final` is the **highest-scoring** draft.

## Test scenarios
- Evaluate → revise from feedback → pass: the feedback must reach the generator verbatim
- Pass on the first draft: stop right away, no wasted calls
- Round limit + keep the best draft
- Malformed evaluator output: retry, and never mistake it for a pass
