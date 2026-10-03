# my-nova-agent

这是我在 **Agent Quest** 里从零写出的 AI Agent。`src/` 下的每一行代码都经过了游戏里的自动判题（见 `PROGRESS.md`）。

## 快速开始

```bash
npm install
npm test                  # 用通关时的全部判题场景做回归（确定性的模拟模型，免费，适合 CI）
cp .env.example .env      # 填上 API Key
npm run agent -- "我是 alice@example.com，最近那单到哪了？"
npm run test:real         # 用真实模型跑一遍判题场景（会产生费用；依赖故障注入的场景会自动跳过）
```

Node ≥ 20。`.env` 支持 Anthropic 和任何 OpenAI 兼容接口（DeepSeek、通义、Kimi、Ollama……），见 `.env.example`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/` | 我写的 Agent：`agent.ts`（主循环）、`tools.ts` / `toolkit.ts`（工具）、`resilience.ts`（重试与超时）、`session.ts`（上下文压缩）、`memory.ts`、`rag.ts`、`planner.ts`、`workflows.ts`、`approval.ts`、`streaming.ts`、`agents/`（多 Agent）、`evals.ts`、`guardrails.ts`、`observability.ts`、`mcp.ts`、`app.ts`（毕业项目） |
| `tests/` | 回归测试：游戏里的判题场景 |
| `aq/engine/` | `agent-quest` 运行时：统一消息格式、Anthropic / OpenAI 适配器、网关（校验、限额、trace）、模拟模型、判题引擎 |
| `aq/content/` | 各关卡的判题场景、模拟模型脚本和模拟业务数据（Nova 的订单系统、帮助中心文档等） |
| `bin/agent.ts` | 命令行入口 |
| `examples/` | 与主流 SDK 的对照迁移示例 |
| `PRODUCTION_CHECKLIST.md` | 上线前检查清单 |

## 关于 `agent-quest` 这个依赖

我的代码只通过 `import { chat, chatStream, sleep, log, ... } from 'agent-quest'` 访问模型。它是一层很薄的门面（`aq/engine/runtime/api.ts`），底下是网关和厂商适配器。

- **测试时**：判题引擎把它接到确定性的模拟模型和虚拟时钟上，所以测试可以复现、并且很快。
- **运行时**：`aq/node-runtime.ts` 的 `useRealModel()` 把它接到 `.env` 里配置的真实模型上。
- **迁移到生产框架时**：只需要替换这一层，或者参考 `examples/` 换成官方 SDK。保留 `tests/` 作为迁移前后的回归 eval。

## 接入真实业务

`bin/agent.ts` 里用的是游戏中的模拟后端（`aq/content/shared/nova.ts`）。接入真实系统时：

1. 实现 `src/toolkit.ts` 里的 `OrderApi` 接口，对接你自己的订单服务；
2. 把 `aq/content/shared/docs.ts` 换成你的知识库，重新建索引；
3. 按 `PRODUCTION_CHECKLIST.md` 逐项检查；
4. 把线上的真实失败案例补充进 `tests/`（或第 16 关写的 eval 集），持续回归。
