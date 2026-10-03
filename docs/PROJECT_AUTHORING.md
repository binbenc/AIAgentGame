# 实战项目编写指南

> 先读 `docs/LEVEL_AUTHORING.md`（引擎 API、mock 写法、中文文案规范），再完整读一遍 `src/projects/p01-helpdesk/`，它是项目的范例。

## 项目和关卡的区别

| | 关卡 | 项目 |
|---|---|---|
| 脚手架 | starter 里有 TODO 清单 | 只有入口函数签名 + 一个“能跑但很差”的朴素实现 |
| 判定 | 针对实现细节的断言 | **和模型无关的结果判定**：数据库最终状态、隐藏测试、执行结果、关键事实 + 引用 |
| 任务 | 3~6 个场景 | 核心集 6~8 个（模拟模型，参与评星）+ 完整集 15~30 个（真实模型基准） |
| 评星 | 全部通过 + 调用次数 / token 预算 | ★ 核心通过率 ≥ passThreshold；★★ 核心全部通过；★★★ 全部通过且 token ≤ tokenBudget |
| 领域 | Nova 公司 | 贴近原型的真实领域（甲方各不相同） |

## 第一性原理

1. **判定器不关心实现**。只看结果：状态对不对、测试过没过、事实和引用是否正确。玩家用什么架构都行。
2. **判定器先于 mock 写好，并且要自测**：用标准答案判过，用典型错误判不过。
3. **mock 是一个“有能力、但只会利用它看到的东西”的模型**：玩家给的工具、上下文、指令到位时，它能解出核心任务；缺什么，它就在对应的地方犯错（编造、用旧数据、跳过确认、乱改代码……）。**不要按 `ctx.call` 写死剧本**，要根据请求内容做反应。
4. **参考解法要通用**：不能针对某道题硬编码，因为真实模型的基准会跑完整任务集。
5. 非核心任务不需要 mock 脚本，但它们的判定器必须正确（真实模型会跑它们）。

## 目录结构

```
src/projects/pNN-slug/
  index.ts      ProjectDef（照抄 p01 的写法）
  brief.md      甲方需求文档：背景、需求、验收标准、判定规则
  guide.md      生产要点 + 参考架构（ASCII 图）
  tasks.ts      任务数据 + check()
  mock.ts       核心任务的模拟模型
  env/数据文件   环境：数据 + 原始 API / 现成工具
  starter/      入口文件的朴素实现（必须能跑，但拿不到 ★）
  solution/     参考解法（三星）
```

工作区路径：项目文件放在 `projects/<slug>/` 下，例如 `projects/helpdesk/main.ts`。它可以 import 关卡代码库：`../../agent`、`../../rag`、`../../resilience` 等（文件约定见 LEVEL_AUTHORING.md 的表格）。

## 框架 API（`src/projects/`）

- `types.ts`：`ProjectDef`、`ProjectTask`、`EnvCtx`、`CheckResult`。
- `createEnv(task, ctx)`：每个任务（每次试验）都创建一份全新的环境。**所有副作用都必须通过 `ctx`**：`ctx.traced(name, fn)` 记录工具调用，`ctx.delay(ms)` 模拟延迟，`ctx.log(msg)` 写日志。不要用 `__traced` / `__delay`，因为基准模式会并发运行多个任务。
- `invoke(mod, task, env)`：调用玩家入口模块，返回值交给 `task.check({ env, output, trace, mode })`。
- `usersim.ts`：`createSimUser(spec, ctx)` 创建模拟用户（τ-bench 的做法）。`spec.opening` 是开场白；`spec.script(agentMessage, turn, memory)` 是模拟模式下的脚本；`spec.instruction` 是真实模式下给 LLM 的人设。回复里包含 `STOP`（`###STOP###`）表示用户结束对话。模拟用户的模型调用不计入玩家成本。
- `runner.ts`：`runProject({ project, files, mode, taskIds?, trials?, concurrency? })`。mock 的 `ctx.scenario` 就是任务 id；基准的第 2 次及以后的试验是 `taskId#2` 这样的形式，所以 mock 要用 `ctx.scenario.split('#')[0]`。

## 质量要求

- `npx vitest run tests/projects.test.ts -t pNN`：参考解法三星；starter 0 星；声明有效。
- `PROJECT=pNN npm run project-report`：逐题查看参考解法和 starter 的结果。
- 至少写 4 个“典型错误”版本的解法（例如：不验证身份、不等用户确认、只取第一个检索结果、不跑测试就提交），确认它们分别在预期的任务上失败，失败信息能指导玩家改进。
- `tokenBudget` ≈ 参考解法 token 的 1.2 倍。
