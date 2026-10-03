## 任务一：在 `toolkit.ts` 中设计订单工具

实现 `createOrderTools(api)`，返回 3 个工具，分别封装 `api.searchOrders`、`api.cancelOrder`、`api.refundPolicy`：

- 工具名用 snake_case 动词短语；description 至少 20 个字，写清**做什么、什么时候用**。
- **每个参数都要有 description**。
- 查询订单的工具：有一个邮箱参数，还有一个 `status` 参数，值为枚举 `pending | shipped | delivered | cancelled`（选填）。
- 取消订单的工具：订单号参数的 description 要写明格式（例如 `NV-100001`）；另有一个必填的取消原因参数。
- 查询工具的返回值要**精简**：只保留 `id / createdAt / product / amount / status`，去掉所有 `_` 开头的内部字段。

## 任务二：修改 `agent.ts`

工具抛出异常时，Agent 不能崩溃。要返回 `{ type: 'tool_result', tool_use_id, content: 错误信息, is_error: true }`，让模型自己处理。

## 判题场景
- 工具规范检查
- 按状态查询：只返回已发货的订单
- 取消成功
- 取消失败：工具出错时 Agent 要优雅降级
