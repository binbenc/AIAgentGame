## 任务

新建 `refine.ts`，实现评审者-优化者（evaluator-optimizer）循环：

```ts
writeWithReview(brief: string, opts: { rubric: string[]; maxRounds?: number }): Promise<RefineResult>
// RefineResult = { final, passed, rounds, history: { draft, verdict }[] }
// verdict      = { pass: boolean, score: 0~10, feedback: string[] }
```

1. **`generate(brief, previous?)`**：生成者。第一稿只看需求；修改时，user 消息里要带上**需求 + 上一版草稿 + 每一条评审意见**。
2. **`evaluate(draft, rubric)`**：评审者。
   - 用**独立的 system 提示词**（评审角色，不和生成者共用）；
   - user 消息里**逐条列出评分标准**，草稿放在 `<draft>...</draft>` 标签里；
   - 要求只输出 JSON `{"pass", "score", "feedback"}`，用 `parseJsonLoose`（`./structured`）+ `VerdictSchema` 校验；
   - 解析或校验失败：把错误反馈给评审者**重试一次**；仍然失败就抛错。**解析不了的输出绝不能当成通过。**
3. **`writeWithReview`**：循环最多 `maxRounds`（默认 3）轮：生成 → 评审 → 记入 `history`。
   - 通过就立即停止，返回这一稿；
   - 到达上限仍未通过：`passed: false`，`final` 为**得分最高**的一版。

## 判题场景
- 评审 → 按意见修改 → 通过：意见要原样传给生成者
- 一稿通过：立即停止，不浪费调用
- 轮数上限 + 保留最好的一版
- 评审输出格式错误：重试，不能误判为通过
