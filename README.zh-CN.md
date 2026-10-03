# 🎮 Agent Quest · AI Agent 工程闯关

🌐 [English](README.md) | **简体中文**

用游戏的方式学习 AI Agent 工程。20 个关卡，从一次模型调用写到一个生产级 Agent：每一关都是**真实的 TypeScript 代码 + 自动判题**，最后把你自己写的 Agent 导出成一个可以运行的 Node 工程。

🚀 **在线体验：<https://binbenc.github.io/AIAgentGame/>**（纯静态站点，进度只存在你自己的浏览器里；默认用模拟模型，不需要 API Key）

- 💻 **真实代码**：在浏览器里用 Monaco 编辑器写 TS，代码跑在 Web Worker 沙箱里。
- 💥 **真实失败**：确定性的模拟模型会按剧情制造线上事故（限流、幻觉工具、坏 JSON、上下文溢出、prompt 注入……），你需要亲手修好。
- 📊 **可量化**：通过 ★ / 模型调用次数达标 ★★ / token 达标 ★★★；Trace 面板逐步展示 Agent 的每一次模型调用、工具调用，以及 Anthropic / OpenAI 两种协议的原始报文。
- 🏭 **能落地**：随时切换到真实模型（Claude / OpenAI / DeepSeek / 通义 / Kimi / Ollama）；毕业时导出工程，`npm install && npm test` 直接可跑。

## 🏆 实战项目

通关后解锁（设置里开启自由模式可提前体验）。每个项目以经典 Agent 案例或基准为原型：真实环境 + 一批任务 + **和模型无关的客观判定**，不给 TODO，架构由玩家设计并复用关卡代码库。模拟模型核心集负责评星；用真实模型跑「基准」，输出 pass@1、pass^k、token、费用和延迟；每个项目都能单独导出（`npm test` 回归 + `npm run bench` 基准报告）。

| # | 难度 | 项目 | 原型 | 判定 |
|---|---|---|---|---|
| P1 | 🟢 入门 | 帮助中心问答 | Chat with Docs / RAG | 关键事实 + 引用正确 + 不用过时文档 + 该拒答时拒答 |
| P2 | 🟢 入门 | 邮件分拣助手 | LangChain 邮件 Agent | 标签正确；草稿包含必需信息、不泄露内部信息、不落入钓鱼 |
| P3 | 🟡 进阶 | Text-to-SQL 数据助手 | Spider / BIRD | SQL 执行结果与标准答案一致；数据库不能被修改 |
| P4 | 🟡 进阶 | 会议日程助手 | AppWorld | 日历最终状态满足时区、工作时间、会议室等约束；该问时先问 |
| P5 | 🟡 进阶 | 零售客服 | τ-bench (retail) | 数据库最终状态 + 政策合规（先验身份、逐项确认） |
| P6 | 🟠 高级 | 旅行规划 | TravelPlanner | 硬约束检查器（预算、营业时间、闭馆日、偏好、可行性） |
| P7 | 🟠 高级 | 编码 Agent | SWE-bench / mini-swe-agent | 隐藏测试 + 原有测试不回归 + 不许改测试 |
| P8 | 🟠 高级 | 数据分析 Agent | Code Interpreter / DABench | 数值答案（容差）+ 代码确实执行过且可复现 |
| P9 | 🔴 专家 | 深度研究 | Anthropic 多 Agent 研究系统 / GAIA | 多跳答案 + 证据来源确实被读取 + 不被注入 |
| P10 | 🔴 专家 | 网页操作 Agent | WebArena | 网站最终状态（订单、购物车、地址）+ 没有多余操作 |
| P11 | 🔴 专家 | 运维 on-call Agent | ITBench / AIOpsLab | 根因正确 + 系统恢复 + 修复经审批 + 最小变更 + 事后报告 |

📝 编写方法见 [docs/PROJECT_AUTHORING.md](docs/PROJECT_AUTHORING.md)。

## 🛠️ 开发

```bash
npm install
npm run dev              # 本地开发 http://localhost:5173
npm test                 # 引擎 + 关卡完整性测试（每关参考实现三星通关、初始代码不能通关、回归）
npm run budgets          # 打印每关参考实现的调用次数 / token，用来校准星级预算
npm run verify:export    # 用全部参考实现生成导出工程，在临时目录 npm install && npm test && tsc
npm run verify:project-export   # 每个实战项目单独导出并验证（PROJECT=p05 只验证一个）
PROJECT=p05 npm run project-report   # 逐题查看项目参考解法 / starter 在核心集上的结果
npx playwright test      # 端到端冒烟测试
npm run build            # 纯静态产物 → dist/，可以部署到任何静态托管（Vercel / Pages / Nginx / 内网）
npm run proxy            # 本地 CORS 代理（只监听 127.0.0.1，只转发白名单域名）
```

🤖 每次推送到 `main`，[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) 会自动测试、构建并部署到 GitHub Pages。

## 🏗️ 架构

```
主线程（React UI）                              Web Worker（沙箱，每次运行新建，运行完销毁）
 剧情/任务 │ Monaco 多文件编辑器 │ 判题结果 + Trace     玩家 TS 代码 ──sucrase──▶ CJS ──迷你模块加载器
 设置（API Key 只存在这里）                      判题引擎 runSuite（场景、断言、星级）
 真实模型 Provider（Anthropic SDK / OpenAI fetch）◀──RPC── agent-quest 门面 → Gateway → Provider
                                                                   └─ 模拟模式：MockProvider + 虚拟时钟
```

| 目录 | 说明 |
|---|---|
| `src/engine/llm/` | 统一消息格式（`types.ts`）、请求校验、token 估算、流式工具、Anthropic / OpenAI 适配器、模拟模型、网关 |
| `src/engine/runtime/api.ts` | 玩家代码 `import ... from 'agent-quest'` 拿到的门面 |
| `src/engine/judge/` | 判题引擎：场景、断言、星级 |
| `src/engine/sandbox/` | 模块加载器、Worker、宿主 RPC |
| `src/engine/clock.ts` | 虚拟时钟：sleep 按到期时间唤醒，退避、超时、并行耗时都可以测，而且瞬间完成 |
| `src/content/levels/lNN-*/` | 关卡：剧情、任务、生产要点、提示、starter、参考实现、判题场景 + 模拟模型 |
| `src/content/shared/` | 共享的模拟业务数据（Nova 订单系统、帮助中心文档、MCP 设备服务……） |
| `src/projects/pNN-*/` | 实战项目：环境、任务集、判定器、模拟模型、starter、参考解法 |
| `src/export/` | 毕业导出：模板 + 打包 |
| `proxy/agent-proxy.mjs` | 零依赖的本地 CORS 代理 |

📂 **工作区是累积的**：玩家在所有关卡里共用一个虚拟文件系统，后面的关卡会 import 前面写的模块。跳关时，缺失的文件会用参考实现补齐，并在界面和导出的 `PROGRESS.md` 里标注出来。

🔒 **安全**：API Key 只存在主线程（默认只存在内存，勾选后才写入 localStorage），沙箱里的玩家代码只能通过 RPC 请求宿主代为调用模型，拿不到 Key。

## 🧩 新增或修改关卡

见 [docs/LEVEL_AUTHORING.md](docs/LEVEL_AUTHORING.md)。`npm test` 会自动检查：参考实现能三星通关、初始代码不能通关、文件声明有效，以及最终工作区能通过所有关卡（回归）。

## 🌍 i18n

界面文案在 `src/i18n/zh.json`（i18next）。关卡内容是 Markdown，按关卡目录组织；要加英文，可以新增 `story.en.md` 等文件，并在 `LevelDef` 上增加语言维度。

## 📄 许可证

[MIT](LICENSE)
