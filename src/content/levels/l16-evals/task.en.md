## Task

Create `evals.ts` and build a small but complete eval framework:

```ts
type EvalCase = { id, input, expected?, keywords?, rubric? }
type Grader   = { name, grade(c, output) → { pass, score (0–1), reason? } | null }

exactMatch(): Grader                 // provided, as an example
includesAll(keywords?): Grader       // name: 'includes_all'
llmJudge(rubric?, { model? }): Grader // name: 'llm_judge'
runEval(cases, target, graders, { concurrency }) → EvalReport
compareReports(baseline, candidate) → { regressions, improvements, deltaPassRate }
```

1. **Graders**: when no argument is passed, use the case's own field (`keywords` / `rubric`). If the case doesn't have it either, return `null` (not applicable).
   - `includesAll`: passes only if every keyword appears; `score` = the fraction that appear; `reason` lists the missing keywords.
   - `llmJudge`: calls the model once as a judge. Use a dedicated judge system prompt that asks for JSON only: `{"pass", "score", "reason"}`. Put the rubric inside `<rubric>...</rubric>` and the answer being graded inside `<output>...</output>`. Validate with `parseJsonLoose` + zod. **If the judge's output is invalid, fail the case (score 0) — don't throw.**
2. **`runEval`**:
   - At most `concurrency` cases run at the same time (a **worker pool** — don't `Promise.all` every case at once);
   - `results` are in the same order as `cases`: `{ id, passed, scores, output, error? }`. `scores` is keyed by grader `name`; graders that don't apply are left out;
   - A case passes only if every applicable grader passes;
   - If `target` throws, record that case as `{ passed: false, scores: {}, output: '', error }` and keep going with the others;
   - `passRate = passed / total cases`; `totals = { cases, passed, failed, errored }` (`failed` only counts cases that ran but didn't pass).
3. **`compareReports`**: line the two reports up by `id`. `regressions` = passed in the baseline but not in the candidate; `improvements` = the other way round; `deltaPassRate = candidate pass rate - baseline pass rate`.

## Test scenarios
- Grader unit tests: exactMatch / includesAll / llmJudge (the judge must receive the rubric and the answer)
- A full eval run: pass rate, scores, totals
- Concurrency limit: never more than `concurrency` cases at once
- One failure doesn't sink the run: target throws, judge returns invalid output
- Regression detection: compare two versions of the system prompt and find the cases that got worse
