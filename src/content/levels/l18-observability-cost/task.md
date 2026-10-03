## 任务一：改造 `agent.ts`（依赖注入）

`AgentOptions` 新增可选字段 `chat?: (req: ChatRequest) => Promise<ChatResponse>`。传了就用它调用模型，没传就用 `agent-quest` 的 `chat`。其它行为**保持不变**——之前所有关卡都会用这份 `agent.ts` 回归测试。

## 任务二：`observability.ts`

### 计费与埋点
价格表 `PRICES`（美元 / 百万 token，按响应里的 `model` 计费）：

| model | 输入 | 输出 |
|---|---|---|
| `mock-default` | $3 | $15 |
| `mock-fast` | $1 | $5 |

- `costOf(model, usage)`：`(输入 token × 输入单价 + 输出 token × 输出单价) / 1_000_000`。
- `instrument(chatFn, tracer, { feature })`：返回一个包装后的 chat 函数。每次调用记录一个 span：`{ feature, model, latencyMs, inputTokens, outputTokens, costUsd, error? }`。耗时用 `agent-quest` 的 `now()` 计算。调用失败时也要记录 span（token 和费用记 0，`error` 写错误信息），然后**把错误继续抛出去**。
- `summarize(spans)`：按 `feature` 汇总出 `{ calls, errors, inputTokens, outputTokens, costUsd, p50LatencyMs, p95LatencyMs }`。分位数用最近秩法：升序排序后取第 `ceil(p/100 × n)` 个（从 1 开始数）。

### 响应缓存
- `stableKey(value)`：稳定序列化。对象的键排序（跳过 `undefined`），数组保持原顺序。
- `withCache(chatFn, store?)`：key 为 `stableKey(req)`；命中就直接返回，不再调用模型；**失败的结果不缓存**。

### 模型路由
`routeModel(question)`：简单 FAQ 返回 `'fast'`，需要查数据或多步操作的问题返回 `'default'`。用零成本的规则判断即可（长度、订单号、邮箱、“帮我 / 取消 / 退款 / 然后”之类的关键词）。

### 预算守卫
`withBudget(chatFn, { maxUsd })`：返回的函数带一个 `spent()` 方法。**调用之前**先预估：`已花费 + 本次输入成本`（输入 token 数用 `countTokens(req)`，单价按 `req.model` 档位：`fast` → `mock-fast`，其余 → `mock-default`）。超过 `maxUsd` 就抛出 `BudgetExceededError`，错误信息里要有“预算”二字；调用成功后把实际费用累加进去。

### 组合：`createSupportBot(tools, { maxUsd? })`
返回 `{ tracer, answer(question, feature), report(), spent() }`。`answer` 用 `routeModel` 选模型，把 `withCache(instrument(withBudget(chat), tracer, { feature }), cache)` 通过 `opts.chat` 注入 `runAgent`。缓存放在最外层：命中缓存时不调用模型、不记 span、不花预算。

## 判题场景
- 计费、埋点与汇总（单元测试）
- `runAgent` 支持注入 `chat`，不传时行为不变
- 按功能归因 + 模型路由：span 和账单（trace）逐条对得上
- 响应缓存：同一个 FAQ 只调用一次模型
- 预算守卫：失控循环在超预算**之前**被拦下
