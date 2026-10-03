## 任务

新建 `planner.ts`，实现 Plan-and-Execute：

```ts
planAndExecute(goal: string, tools: Tool[], opts?: PlanOptions): Promise<{ plan, stepResults, output }>
```

1. **规划**：`makePlan(request, tools)` 调用一次 `chat()`（**不带 `tools`**，在 system 里列出工具清单即可），让模型只输出 JSON 计划 `{"steps": [{"id": 1, "task": "..."}]}`。用第 2 关的 `parseJsonLoose` 解析，用 `PlanSchema`（zod）校验；不合法就带着校验错误（点名字段）重试 `planRetries` 次（默认 1），仍失败就抛错。
2. **执行**：按顺序执行每一步，每一步调用一次 `runAgent(prompt, tools, { system: EXECUTOR_SYSTEM })`。`prompt` 是一段**全新的对话**，只包含：
   - 用户的原始请求；
   - 之前步骤的**结果**（`runAgent` 的 `output`，不是完整的 `messages`）；
   - 用 `当前步骤：` 标出的这一步要做的事。
3. **重新规划**：一步失败（`stopReason` 不是 `'done'`，或者输出里含“步骤失败”），就把它记为 `ok: false`，再带着**失败原因**调用 `makePlan` 为剩下的工作重新规划，用新步骤替换掉还没执行的步骤。最多重新规划 `maxReplans` 次（默认 1）。
4. **汇总**：最后调用一次 `chat({ system: SYNTH_SYSTEM, ... })`，把原始请求和每一步的结果交给模型，写出最终回复。

返回值：`plan` 是实际执行的步骤，`stepResults` 每步一条 `{ id, task, ok, output }`，`output` 是汇总后的回复。

## 判题场景
- 先规划，再按序执行：一个包含 4 件事的请求，每件事都要在最终回复里得到回应
- 步骤之间只传结果：后面的步骤要用上前面步骤查到的信息，而不是重新查一遍
- 步骤失败 → 带着失败原因重新规划
- 计划格式不合法 → 校验、反馈、重试
