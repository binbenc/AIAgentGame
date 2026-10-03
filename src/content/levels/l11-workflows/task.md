## 任务

新建 `workflows.ts`，实现三种常见的工作流模式（prompt 常量已经写好）。

### 1. 路由（Routing）

- `classifyTicket(text)`：调用一次 `chat`，**必须使用 `model: 'fast'`**，让模型只输出一个类别名。输出先 `trim()` + `toLowerCase()`，再用 `RouteSchema`（zod 枚举）校验；不在枚举里就兜底为 `'other'`。
- `routeTicket(text, api)`：先分类，再分派给处理器，返回 `{ route, reply }`：
  - `order_status`：从文本里取出订单号，调用 `api.getShipping(id)`，用模板拼出回复——**不调用模型**；
  - `refund`：直接返回 `api.refundPolicy()` 的内容——**不调用模型**；
  - `tech_support`：开放式问题，用 `TECH_SYSTEM` 调用一次模型；
  - `complaint` / `other`：固定话术，转人工。

### 2. 提示链（Prompt chaining）

`draftReply(ticket)`：抽取 → 闸门 → 起草 → 闸门 → 润色，返回 `{ ok: true, reply }` 或 `{ ok: false, reason }`。

1. 抽取：`EXTRACT_SYSTEM`，用 `parseJsonLoose` + `ExtractSchema` 校验。
2. **闸门 1**：没有订单号，立即返回 `ok: false`，后面的步骤都不再调用。
3. 起草：`DRAFT_SYSTEM`。
4. **闸门 2**（纯代码检查）：草稿必须包含订单号，且不能出现 `FORBIDDEN` 里的词，否则返回 `ok: false`。
5. 润色：`POLISH_SYSTEM`，把客户情绪和草稿原文交给模型。

### 3. 并行化（Parallelization）

`moderate(text)`：对 `CHECKS` 里的每一项**单独**调用一次模型（`model: 'fast'`，只回答 YES / NO），三个调用用 `Promise.all` **同时发出**。回答 YES 的检查名放进 `flags`，`allowed = flags.length === 0`。

## 判题场景
- 路由：快模型分类，查物流 / 退货政策不再调用模型
- 路由：开放问题交给模型；类别不在枚举里时兜底为 other
- 提示链：抽取 → 起草 → 润色
- 闸门：缺少订单号、草稿里有越权承诺时提前停下
- 并行：三项审核同时跑，耗时≈最慢的那一个
