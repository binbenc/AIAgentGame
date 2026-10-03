# 🎮 Agent Quest · Learn AI Agent Engineering by Playing

🌐 **English** | [简体中文](README.zh-CN.md)

Learn AI agent engineering as a game. 20 levels take you from a single model call to a production-grade agent. Every level is **real TypeScript code + automatic grading**, and at the end you export the agent you wrote as a runnable Node project.

🚀 **Try it online: <https://binbenc.github.io/AIAgentGame/>** (a fully static site — your progress stays in your own browser; it uses a mock model by default, so no API key is needed)

> 🗣️ The in-app UI and level content are currently in Simplified Chinese. The i18n layer is in place for an English version.

- 💻 **Real code**: write TypeScript in the browser with the Monaco editor; your code runs in a Web Worker sandbox.
- 💥 **Real failures**: a deterministic mock model stages production incidents as part of the story — rate limits, hallucinated tools, broken JSON, context overflow, prompt injection… — and you fix them yourself.
- 📊 **Measurable**: ★ for passing, ★★ for staying within the model-call budget, ★★★ for staying within the token budget. The Trace panel shows every model call and tool call step by step, plus the raw wire payloads for both the Anthropic and OpenAI protocols.
- 🏭 **Production-ready**: switch to a real model at any time (Claude / OpenAI / DeepSeek / Qwen / Kimi / Ollama). On graduation, export the project — `npm install && npm test` runs out of the box.

## 🏆 Projects

Unlocked after you finish the levels (or enable free mode in Settings to try them early). Each project is modeled on a classic agent case study or benchmark: a real environment + a task set + **objective, model-independent grading**. There are no TODOs — you design the architecture yourself and reuse the code you wrote in the levels. A mock-model core set determines your stars; run a **benchmark** against a real model to get pass@1, pass^k, tokens, cost and latency. Every project can be exported on its own (`npm test` for regression, `npm run bench` for a benchmark report).

| # | Tier | Project | Modeled on | Grading |
|---|---|---|---|---|
| P1 | 🟢 Beginner | Help-center Q&A | Chat with Docs / RAG | Key facts + correct citations + no stale docs + refuses when it should |
| P2 | 🟢 Beginner | Email triage assistant | LangChain email agent | Correct labels; drafts contain required info, leak nothing internal, don't fall for phishing |
| P3 | 🟡 Intermediate | Text-to-SQL data assistant | Spider / BIRD | SQL execution result matches the gold answer; the database must not be modified |
| P4 | 🟡 Intermediate | Meeting scheduler | AppWorld | Final calendar state satisfies time-zone, working-hours and room constraints; asks before acting when it should |
| P5 | 🟡 Intermediate | Retail customer service | τ-bench (retail) | Final database state + policy compliance (verify identity first, confirm each item) |
| P6 | 🟠 Advanced | Travel planner | TravelPlanner | Hard-constraint checker (budget, opening hours, closing days, preferences, feasibility) |
| P7 | 🟠 Advanced | Coding agent | SWE-bench / mini-swe-agent | Hidden tests + no regressions in existing tests + tests must not be modified |
| P8 | 🟠 Advanced | Data analysis agent | Code Interpreter / DABench | Numeric answer (with tolerance) + code actually executed and reproducible |
| P9 | 🔴 Expert | Deep research | Anthropic multi-agent research system / GAIA | Multi-hop answer + cited sources were actually read + resists injection |
| P10 | 🔴 Expert | Web agent | WebArena | Final site state (orders, cart, addresses) + no extra actions |
| P11 | 🔴 Expert | On-call ops agent | ITBench / AIOpsLab | Correct root cause + system restored + approved remediation + minimal change + postmortem |

📝 See [docs/PROJECT_AUTHORING.md](docs/PROJECT_AUTHORING.md) for how projects are written.

## 🛠️ Development

```bash
npm install
npm run dev              # local dev server at http://localhost:5173
npm test                 # engine + level integrity tests (each reference solution earns 3 stars, starters fail, regression)
npm run budgets          # print call / token usage of each level's reference solution, to calibrate star budgets
npm run verify:export    # export a project built from all reference solutions, then npm install && npm test && tsc in a temp dir
npm run verify:project-export   # export and verify each project on its own (PROJECT=p05 to verify just one)
PROJECT=p05 npm run project-report   # per-task results of a project's reference solution / starter on the core set
npx playwright test      # end-to-end tests
npm run build            # pure static output → dist/, deployable to any static host (Vercel / Pages / Nginx / intranet)
npm run proxy            # local CORS proxy (listens on 127.0.0.1 only, forwards only allow-listed domains)
```

🤖 Every push to `main` is tested, built and deployed to GitHub Pages by [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

## 🏗️ Architecture

```
Main thread (React UI)                              Web Worker (sandbox, created per run, destroyed afterwards)
 Story/task │ Monaco multi-file editor │ results + Trace     player TS code ──sucrase──▶ CJS ──mini module loader
 Settings (the API key lives only here)              Grading engine runSuite (scenarios, assertions, stars)
 Real-model providers (Anthropic SDK / OpenAI fetch) ◀──RPC── agent-quest facade → Gateway → Provider
                                                                   └─ mock mode: MockProvider + virtual clock
```

| Directory | Contents |
|---|---|
| `src/engine/llm/` | Unified message format (`types.ts`), request validation, token estimation, streaming utilities, Anthropic / OpenAI adapters, mock model, gateway |
| `src/engine/runtime/api.ts` | The facade player code gets from `import ... from 'agent-quest'` |
| `src/engine/judge/` | Grading engine: scenarios, assertions, stars |
| `src/engine/sandbox/` | Module loader, worker, host RPC |
| `src/engine/clock.ts` | Virtual clock: sleeps wake up in due-time order, so backoff, timeouts and parallel latency are all testable — and finish instantly |
| `src/content/levels/lNN-*/` | Levels: story, task, production notes, hints, starter, reference solution, grading scenarios + mock model |
| `src/content/shared/` | Shared mock business data (Nova order system, help-center docs, MCP device service…) |
| `src/projects/pNN-*/` | Projects: environment, task set, graders, mock model, starter, reference solution |
| `src/export/` | Graduation export: template + bundling |
| `proxy/agent-proxy.mjs` | Zero-dependency local CORS proxy |

📂 **The workspace is cumulative**: all levels share one virtual file system, and later levels import modules written in earlier ones. If you skip a level, missing files are filled in from the reference solution and flagged in the UI and in the exported `PROGRESS.md`.

🔒 **Security**: the API key lives only on the main thread (in memory by default; written to localStorage only if you opt in). Player code in the sandbox can only ask the host to call the model over RPC — it never sees the key.

## 🧩 Adding or changing levels

See [docs/LEVEL_AUTHORING.md](docs/LEVEL_AUTHORING.md). `npm test` checks automatically that the reference solution earns 3 stars, the starter code fails, file declarations are valid, and the final workspace passes every level (regression).

## 🌍 i18n

UI strings live in `src/i18n/zh.json` (i18next). Level content is Markdown organized per level directory; to add English, add files such as `story.en.md` and give `LevelDef` a language dimension.

## 📄 License

[MIT](LICENSE)
