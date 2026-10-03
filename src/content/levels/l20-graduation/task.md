## 任务

在 `app.ts` 中实现 `createSupportAgent(deps)`，返回 `{ tracer, handle(userId, message) }`。`handle` 是线上每条用户消息的入口，返回 `{ reply, model, costUsd, handedOff }`。

组装顺序（每一步都复用你之前写过的模块）：

1. **模型路由**：`routeModel(message)`（L18）决定用 `fast` 还是 `default`。
2. **工具**：
   - `createOrderTools(deps.orders)`（L5）；其中**取消订单**的工具要用 `requireApproval` 包一层：执行前调用 `deps.approve({ tool, input })`，返回 `false` 时**不执行**，并抛出错误（Agent 循环会把它转成 `is_error`）。
   - `helpCenterTool(deps.kb)`：名为 `search_help_center`，用 `kb.search(query, 3)`（L9）检索，返回每个块的 `[块id]` 和正文。它返回的是运营编辑的外部内容，要用 `untrustedTool`（L17）包起来。
   - `createMemoryTools(deps.memory, userId)`（L8）。
3. **system prompt**：`SUPPORT_SYSTEM` + `UNTRUSTED_POLICY`（L17），再用 `buildSystemWithMemories`（L8）注入 `memory.recall(userId, message, 3)` 召回的记忆。`SUPPORT_SYSTEM` 要要求模型引用帮助中心内容时标注 `[块id]`。
4. **模型调用链**：`instrument(withBudget(chat, { maxUsd }), tracer, { feature: 'support' })`（L18），通过 `runAgent(..., { chat })` 注入。
5. **执行**：`runAgent`（L4–L6，自带重试、超时、坏参数处理），`maxSteps: 8`。
6. **兜底**：预算超限（`BudgetExceededError`）或者步数用完时，**不要抛错**，返回 `HANDOFF_REPLY` 并设置 `handedOff: true`。
7. **输出过滤**：最终回复要经过 `redactSecrets`（L17）。
8. `costUsd` = 本条消息产生的所有 span 的费用之和。

## 判题场景（模拟线上流量）
FAQ 带引用 · 记忆个性化 · 取消订单需审批（批准 / 拒绝） · 帮助中心文档被投毒 · 隐私打码 · 限流自愈 · 预算兜底
