## 任务

新建 `approval.ts`，实现一个可以暂停、等待人工审批的 Agent。工具类型扩展为 `ApprovalTool = Tool & { requiresApproval?: boolean }`。

### `runWithApproval(task, tools, opts)`

和 `runAgent` 一样跑循环，但模型调用了 `requiresApproval: true` 的工具时：

- **不要执行它**；同一轮里的其它安全工具照常执行（用 `agent.ts` 里的 `executeToolCalls`）；
- 返回 `{ status: 'needs_approval', pending: { toolUseId, name, input }, state }`。

`state` 必须是**纯 JSON 数据**：经过 `JSON.parse(JSON.stringify(state))` 之后还能正常恢复。它至少要包含对话 `messages`、已经走过的步数，以及这一轮已经执行完的工具结果和还在等待的调用。

没有调用危险工具时，正常跑完，返回 `{ status: 'done', output, state }`。

### `resumeWithApproval(state, decision, tools, opts)`

- `decision.approve === true`：执行这个工具（只执行一次）；
- `decision.approve === false`：**不执行**，回填一个 `is_error: true` 的 tool_result，内容为 `人工审批拒绝：<note>`，让模型自己去跟用户解释；
- 这一轮所有工具的 `tool_result` 要放进**同一条** user 消息（按 tool_use 的顺序），然后继续循环。

## 判题场景
- 危险操作：暂停等审批，安全工具照常执行，state 可序列化
- 批准：从 JSON 往返后的 state 恢复，退款只执行一次
- 拒绝：退款不执行，模型如实告诉用户
- 安全操作：不需要审批时一路跑完
