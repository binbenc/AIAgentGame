## 任务

新建 `evals.ts`，实现一个小而完整的评测框架：

```ts
type EvalCase = { id, input, expected?, keywords?, rubric? }
type Grader   = { name, grade(c, output) → { pass, score(0~1), reason? } | null }

exactMatch(): Grader                 // 已给出，作为示例
includesAll(keywords?): Grader       // name: 'includes_all'
llmJudge(rubric?, { model? }): Grader // name: 'llm_judge'
runEval(cases, target, graders, { concurrency }) → EvalReport
compareReports(baseline, candidate) → { regressions, improvements, deltaPassRate }
```

1. **评分器**：参数没给时，用用例自己的字段（`keywords` / `rubric`）；用例里也没有就返回 `null`（不适用）。
   - `includesAll`：全部关键词出现才通过；`score` = 出现的比例；`reason` 写出缺少哪些关键词。
   - `llmJudge`：调用一次模型当评委。用独立的评委 system 提示词，要求只输出 `{"pass", "score", "reason"}` 的 JSON；评分标准放在 `<rubric>...</rubric>` 里，被评的回答放在 `<output>...</output>` 里。用 `parseJsonLoose` + zod 校验，**评委输出不合法时判为不通过（score 0），不要抛出**。
2. **`runEval`**：
   - 最多 `concurrency` 条用例同时在跑（**工作池**，不要一次性 `Promise.all` 全部用例）；
   - `results` 和 `cases` 顺序一致：`{ id, passed, scores, output, error? }`，`scores` 以评分器 `name` 为键，不适用的评分器不计入；
   - 所有适用的评分器都通过，用例才算通过；
   - `target` 抛错：这条用例记为 `{ passed: false, scores: {}, output: '', error }`，其它用例照常；
   - `passRate = 通过数 / 用例总数`；`totals = { cases, passed, failed, errored }`（failed 只统计跑完但没通过的）。
3. **`compareReports`**：按 `id` 对齐两份报告。`regressions` = 基线通过、新版没通过；`improvements` 反之；`deltaPassRate = 新版通过率 - 基线通过率`。

## 判题场景
- 评分器单元测试：exactMatch / includesAll / llmJudge（评委要拿到评分标准和回答）
- 跑一次完整评测：通过率、scores、totals
- 并发上限：同一时刻不超过 `concurrency` 条
- 单条出错不影响整体：目标抛错、评委输出不合法
- 回归检测：对比两个版本的 system prompt，找出退化的用例
