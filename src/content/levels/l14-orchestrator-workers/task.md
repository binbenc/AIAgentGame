## 任务

新建 `agents/orchestrator.ts`，实现编排者-工作者（orchestrator-workers）模式：

```ts
research(question: string, toolsets: Record<string, Tool[]>): Promise<ResearchReport>
// ResearchReport = { answer, subtasks, workers: WorkerReport[], partial }
// WorkerReport   = { id, goal, ok, summary, error? }
```

`toolsets` 是按数据源分组的工具：`web`（web_search）、`specs`（get_spec_sheet）、`reviews`（get_reviews）。它们的返回值都是很长的原始数据。

1. **`plan(question, toolsets)`**：调用一次模型（不带工具），在请求里**列出可用的工具集名称和工具说明**，要求只输出 JSON：
   `{"subtasks":[{"id":"...","goal":"...","toolset":"web | specs | reviews"}]}`。
   用 `parseJsonLoose`（`../structured`）+ `PlanSchema` 校验，并检查 `toolset` 确实存在。
2. **`runWorker(subtask, tools)`**：每个子任务一个**全新的** `runAgent`（`../agent`）——
   - 任务用字符串（包含 `goal`），不要复用别人的 `messages`；
   - 只给它 `toolsets[subtask.toolset]` 这一组工具；
   - worker 的 system 提示词要求它**只返回精简的要点摘要**，不要粘贴原文；
   - 出错（或没有正常结束）时**不要抛出**，返回 `{ ok: false, summary: '', error }`。
3. 所有 worker 用 `Promise.all` **并行**执行。
4. **`synthesize(question, workers)`**：再调用一次模型，消息里**只放每个 worker 的摘要**；失败的子任务写明 `子任务 <id> 失败：<原因>`，让简报标注“数据缺失”。
5. 返回 `partial = 是否有 worker 失败`。所有 worker 都失败时可以直接抛错。

## 判题场景
- 编排 → 并行 worker → 汇总：每个 worker 只拿到自己的工具集；worker 同时启动；简报覆盖每个子任务
- 上下文隔离 + 只传摘要：worker 之间看不到彼此的数据；汇总请求里没有原始数据，且远小于原文
- 按问题动态拆解：问题只问价格和口碑时，不去查参数
- 单个 worker 失败：其它 worker 照常完成，`partial: true`，简报标注数据缺失
