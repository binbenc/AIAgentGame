# 关卡编写指南

> 面向贡献者：如何新增或修改一个关卡。先完整读一遍 `src/content/levels/l01-hello-model` ~ `l06-resilience`，它们是范例。

## 核心理念

1. **每一关 = 写/修真实代码 + 自动判题**。玩家代码最终会导出成可运行的 Node 工程，所以写的都是生产级模式，不是玩具。
2. **工作区是累积的**：玩家在所有关卡里共用一个虚拟文件系统。第 N 关的参考工作区 = 第 1..N 关的 `solution/` 依次叠加（后面的覆盖前面的同名文件）。
3. **判题必须确定**：模拟模式下用每关的 `mock`（确定性脚本模型）+ 虚拟时钟。真实模型模式会跳过标了 `mockOnly` 的场景。
4. 文案全部用中文；代码标识符用英文。剧情角色：**老周**（CTO/导师）、**Mia**（产品经理）、**阿强**（运维 on-call）、**Vera**（安全负责人）。公司叫 **Nova 科技**（智能家居），玩家是新入职的 AI 工程师。

## 目录结构

```
src/content/levels/lNN-slug/
  index.ts        LevelDef（照抄范例的写法）
  story.md        剧情（2~4 段，带角色对白，引出痛点）
  task.md         ## 任务（接口约定、步骤）+ ## 判题场景（列表）
  knowledge.md    ## 生产落地要点（5~8 条，具体、可执行，可提及主流 SDK/厂商做法）
  suite.ts        LevelSuite：mock + scenarios + budgets
  starter/*.ts    本关**新增**文件的初始代码（带 TODO，必须能被 sucrase 转译）
  solution/*.ts   本关结束时**新增或修改**的文件的完整参考实现
```

`index.ts` 里的 `files`：本关新增的文件写 `{ path, starter }`；需要修改的旧文件写 `{ path }`（不带 starter）。

## 引擎 API（不要修改 src/engine，如果确实需要，先停下来汇报）

- 玩家代码可以 import 的模块只有：相对路径、`'agent-quest'`、`'zod'`。
- `agent-quest`（`src/engine/runtime/api.ts`）：`chat`、`chatStream`（流式，返回值可以 `for await`，也可以 `.finalResponse()`）、`countTokens`、`sleep`、`now`、`log`、`LLMError`、`AbortError`，以及各种类型。
- 统一消息格式见 `src/engine/llm/types.ts`（Anthropic 风格的内容块：text / tool_use / tool_result / opaque）。
- 关卡环境（suite.ts、shared/*.ts 等宿主代码）可以用：
  - `__traced(name, fn)`：包装工具实现，调用会记录到 trace（`ctx.trace.toolCalls(name)`）
  - `__delay(ms)`：模拟 I/O 延迟（虚拟时间，不进 trace）
- mock 辅助（`src/engine/llm/mock-kit.ts`）：`say`、`callTool`、`callTools`、`lastUserText`、`firstUserText`、`lastToolResults`、`allToolUses`、`allToolResults`、`visibleText`、`findTool`、`toolMatching`、`firstRequiredParam`。
- `MockModel = (req, ctx) => MockReply`。`ctx.scenario` 是场景 id，`ctx.call` 是本场景第几次调用（从 0 开始），`ctx.state` 可以跨调用存状态，`ctx.nextId()` 生成 tool_use id。mock 可以 `throw new LLMError(...)` 来模拟故障；`MockReply.latencyMs` 可以指定延迟。
- **mock 必须对玩家真实发出的请求做出反应**（看 system、tools 的 schema 和描述、消息内容），这样“写得好的代码”才能拿到好结果。不要只按 `ctx.call` 写死。
- token 用量是根据请求内容估算出来的（`src/engine/llm/tokens.ts`），上下文越长 input_tokens 越多。
- 每个场景有自己绑定的 `agent-quest` 实例，场景结束后网关会关闭：没有 await 完的后台任务再调用模型会直接失败，不会串到下一个场景。
- 虚拟时钟：`sleep`/`__delay` 按到期时间顺序唤醒，所以 `Promise.all` 并行执行的耗时 = 其中最大的那个，而不是总和。
- 判题上下文 `ScenarioCtx`（写成 `async run(ctx: ScenarioCtx)`，必须显式标注类型，否则 `ctx.assert` 的类型收窄会报 TS2775）：`ctx.load('file.ts')`、`ctx.loadFresh('file.ts')`（全新的模块系统，模拟进程重启）、`ctx.trace`（`llmCalls()`、`toolCalls(name?)`、`events`、`totalTokens()`、`logs()`）、`ctx.now()`、`ctx.assert/eq/includes/fail`（失败信息用中文，要写清楚**哪里不对、应该怎么改**）。
- 共享业务数据：`src/content/shared/nova.ts`（`createNova()`、`basicNovaTools()`、`CUSTOMERS`、`ORDERS`、`SHIPPING`、`REFUND_POLICY`）。你可以在 `src/content/shared/` 下新增文件，但**不要修改已有的共享文件**。

## 工作区文件约定（第 1~6 关已定稿，后面的关卡在此基础上构建）

| 文件 | 导出 |
|---|---|
| `llm.ts` | `ask(question, {system?, maxTokens?}) → {text, usage, truncated}`、`NOVA_SYSTEM`、`askNova` |
| `structured.ts` | `TicketSchema`、`parseJsonLoose(text)`、`extractTicket(email, maxRetries?)` |
| `tools.ts` | `interface Tool { spec: ToolSpec; run(input): unknown }`、`textOf(content)`、`toToolContent(output)`、`makeWeatherTool`、`answerOnce` |
| `agent.ts` | `runAgent(task: string \| Message[], tools, opts?) → {output, steps, messages, stopReason: 'done' \| 'max_steps'}`；`AgentOptions {system?, model?, maxSteps?(10), retries?(3), toolTimeoutMs?(10000)}`；`executeToolCalls(calls, tools, opts?)`（并行执行、错误/未知工具/坏参数/超时都转成 is_error 结果）；`checkInput(tool, input)` |
| `resilience.ts` | `isRetryable`、`withRetry(fn, {retries, baseDelayMs, maxDelayMs})`、`withTimeout(promise, ms, label)` |
| `toolkit.ts` | `createOrderTools(api) → Tool[]`（search_orders / cancel_order / get_refund_policy） |
| L7–L20 | `session.ts`、`memory.ts`、`rag.ts`、`planner.ts`、`workflows.ts`、`approval.ts`、`streaming.ts`、`agents/orchestrator.ts`、`agents/refine.ts`、`evals.ts`、`guardrails.ts`、`observability.ts`（L18 给 `agent.ts` 加了可选的 `chat` 注入）、`mcp.ts`、`app.ts`（毕业项目，组装以上全部） |

规则：
- 后面的关卡**优先新建文件**，然后 import 前面的模块（例如 `import { runAgent } from './agent'`）。
- **只有 L18 允许修改 `agent.ts`**，而且只能做向后兼容的增量修改（例如给 `AgentOptions` 加可选字段）。其他关卡需要不同的循环时，就在自己的文件里另写，并复用 `executeToolCalls` 等导出。
- 一个文件只能由一个关卡新建（文件名见下面的分配表）。

## 完整性要求（`tests/levels.test.ts` 会自动检查）

1. 参考实现（第 1..N 关的 solution 叠加）在模拟模式下**全部场景通过，并且拿到三星**。
2. 初始工作区（第 1..N-1 关的 solution 叠加 + 本关的 starter）**不能通过**。
3. `files` 声明有效：每个文件要么有 starter，要么已存在于之前的工作区，并且都有 solution。
4. 回归：最终工作区要通过**所有**关卡。

预算（`budgets`）：先运行 `npm run budgets` 看参考实现的消耗，`calls` 设为参考实现的调用次数，`tokens` 设为参考实现的约 1.2 倍，让“写得冗长 / 多调了模型”的实现拿不到满星。

单独测某一关：`npx vitest run -t "l07"`。

## 场景设计清单

- 3~6 个场景，覆盖：正常路径、本关要解决的痛点、边界/失败情况。
- 尽量既检查**结果**（输出内容），又检查**过程**（trace：调用了几次模型、请求里有什么、工具调了几次、虚拟耗时多少）。
- 依赖 mock 故障注入的场景标 `mockOnly: true`。
- 断言信息要能教会玩家：不只说“错了”，还要说明“应该怎样”。
- starter 要给出清晰的 TODO 骨架和类型签名，保证只靠 task.md + hints 就能写完。
- hints 2~4 条，由浅入深，最后一条可以接近答案。
