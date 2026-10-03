# my-nova-agent

This is the AI agent I built from scratch in **Agent Quest**. Every line of code under `src/` passed the game's automated grading (see `PROGRESS.md`).

## Quick start

```bash
npm install
npm test                  # regression run of every grading scenario I passed (deterministic mock model, free, CI-friendly)
cp .env.example .env      # add your API key
npm run agent -- "I'm alice@example.com, where's my latest order?"
npm run test:real         # run the grading scenarios against a real model (costs money; scenarios that rely on fault injection are skipped)
```

Node ≥ 20. `.env` supports Anthropic and any OpenAI-compatible API (DeepSeek, Qwen, Kimi, Ollama, ...); see `.env.example`.

## Layout

| Path | Contents |
|---|---|
| `src/` | My agent: `agent.ts` (main loop), `tools.ts` / `toolkit.ts` (tools), `resilience.ts` (retries and timeouts), `session.ts` (context compaction), `memory.ts`, `rag.ts`, `planner.ts`, `workflows.ts`, `approval.ts`, `streaming.ts`, `agents/` (multi-agent), `evals.ts`, `guardrails.ts`, `observability.ts`, `mcp.ts`, `app.ts` (graduation project) |
| `tests/` | Regression tests: the grading scenarios from the game |
| `aq/engine/` | The `agent-quest` runtime: unified message format, Anthropic / OpenAI adapters, gateway (validation, limits, tracing), mock models, grading engine |
| `aq/content/` | Each level's grading scenarios, mock model scripts and mock business data (Nova's order system, help center docs, etc.) |
| `bin/agent.ts` | Command-line entry point |
| `examples/` | Side-by-side migration examples for popular SDKs |
| `PRODUCTION_CHECKLIST.md` | Pre-launch checklist |

## About the `agent-quest` dependency

My code reaches the model only through `import { chat, chatStream, sleep, log, ... } from 'agent-quest'`. It's a thin facade (`aq/engine/runtime/api.ts`) over the gateway and the provider adapters.

- **In tests**: the grading engine wires it to a deterministic mock model and a virtual clock, so tests are reproducible and fast.
- **At runtime**: `useRealModel()` in `aq/node-runtime.ts` wires it to the real model configured in `.env`.
- **When moving to a production framework**: replace just this layer, or switch to an official SDK following `examples/`. Keep `tests/` as your regression eval before and after the migration.

## Connecting real systems

`bin/agent.ts` uses the game's mock backend (`aq/content/shared/nova.ts`). To connect your real systems:

1. Implement the `OrderApi` interface in `src/toolkit.ts` against your own order service;
2. Replace `aq/content/shared/docs.ts` with your knowledge base and rebuild the index;
3. Go through `PRODUCTION_CHECKLIST.md` item by item;
4. Add real production failures to `tests/` (or the eval set you wrote in Level 16) and keep running them.
