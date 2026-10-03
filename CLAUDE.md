# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Agent Quest: a static web app (Vite + React 19 + TypeScript + Tailwind v4 + Monaco) that teaches AI agent engineering as a game. Players write real TypeScript in the browser; it runs in a Web Worker sandbox and is graded automatically. There are two modes: 20 cumulative **levels** (`src/content/levels/`) and 11 open-ended **projects** modeled on agent benchmarks (`src/projects/`). Everything works offline against a deterministic mock model; real models (Anthropic / OpenAI-compatible) are optional and use the player's own key.

UI copy, level/project content and assertion messages are written in **Simplified Chinese**; code identifiers are English. `README.md` is English, `README.zh-CN.md` is the Chinese mirror — keep both in sync.

## Commands

npm only (no pnpm). TypeScript is v7 (native `tsc`).

```bash
npm run dev                       # http://localhost:5173
npm test                          # vitest: engine + level + project integrity (tests/**/*.test.ts)
npx vitest run -t "l07"           # one level
npx vitest run tests/projects.test.ts -t p05   # one project
npx tsc --noEmit -p .             # typecheck (delete the stray tsconfig.tsbuildinfo it may leave)
npm run build                     # tsc -b && vite build → dist/
npx playwright test               # e2e (starts vite on :5199); single file: npx playwright test compare
npm run budgets                   # calls/tokens of each level's reference solution (for star budgets)
PROJECT=p05 npm run project-report        # per-task results of a project's solution vs starter
npm run verify:export             # export the full-solution workspace, npm install && test && tsc in a temp dir
npm run verify:project-export     # same per project (PROJECT=p05 for one)
npm run proxy                     # local CORS proxy for real-model calls
```

`budgets` / `verify:*` / `project-report` are vitest files in `scripts/`, selected via the `SCRIPT=` env var in `vite.config.ts`.

CI: `.github/workflows/deploy-pages.yml` runs `npm test` + build and deploys to GitHub Pages on every push to `main` (https://binbenc.github.io/AIAgentGame/). `base: './'` + hash routing make the subpath work — keep asset URLs relative.

## Architecture

**Engine (`src/engine/`) — the core; change it carefully.**
- `llm/`: unified Anthropic-style message format (`types.ts`: text / tool_use / tool_result / opaque blocks; thinking blocks pass through untouched), request validation, token *estimation* (`tokens.ts`), streaming, providers (`providers/anthropic.ts` via SDK, `openai.ts` via fetch, `mock.ts`), and `gateway.ts` (validation, call limits, tracing, `close()`).
- `runtime/api.ts`: the `agent-quest` module player code imports (`chat`, `chatStream`, `countTokens`, `sleep`, `now`, `log`…). `createApi()` builds a **per-scenario bound instance**; the gateway is closed when a scenario ends so stray background calls fail instead of leaking into the next scenario. Host-only helpers `__traced` / `__delay` live here too.
- `clock.ts`: VirtualClock — `sleep`/`__delay` wake in due-time order, so backoff/timeouts/parallelism are testable and instant.
- `sandbox/`: sucrase transpiles TS → CJS, run by a mini module loader (`loader.ts`). Allowed imports in player code: relative paths, `agent-quest`, `zod`. `worker.ts` runs suites/projects; real model calls go over RPC to the main thread (`host.ts`), which holds the API key — the key never enters the worker.
- `judge/`: `runSuite` for levels. `ScenarioCtx` offers `load`, `loadFresh` (fresh module system = simulated restart), `trace`, `assert/eq/includes/fail`. Always annotate `async run(ctx: ScenarioCtx)` or `ctx.assert` narrowing errors with TS2775.

**Levels (`src/content/levels/lNN-*/`)**: `index.ts` (LevelDef), `story.md` / `task.md` / `knowledge.md`, `suite.ts` (mock model + scenarios + budgets), `starter/`, `solution/`. The **workspace is cumulative**: the reference workspace for level N is solutions 1..N overlaid (`content/workspace.ts`: `solutionThrough`, `baselineBefore`). Later levels import earlier modules (`./agent`, `./rag`…). Skipped levels are filled from reference solutions and marked "borrowed". Stars: ★ pass, ★★ calls ≤ budget, ★★★ tokens ≤ budget. **Read `docs/LEVEL_AUTHORING.md` before touching levels** — it has the file-ownership table (which level creates which workspace file; only L18 may modify `agent.ts`) and the rule not to modify existing `src/content/shared/` files.

**Projects (`src/projects/pNN-*/`)**: `ProjectDef` with `createEnv` (fresh env per task/trial, may be async), `invoke`, `tasks` with model-independent `check()` (DB state, hidden tests, execution results, facts + citations), and `mock` for the core set. Workspace path is `projects/<slug>/…` and may import level modules via `../../agent` etc. `runner.ts` computes pass@1, pass^k, cost (`pricing.ts`), p50/p95; later trials have scenario ids like `taskId#2` (mocks must use `ctx.scenario.split('#')[0]`). Env side effects must go through `EnvCtx` (`ctx.traced`, `ctx.delay`, `ctx.log`), **not** `__traced`/`__delay`, because benchmarks run tasks concurrently. `usersim.ts` is a τ-bench-style simulated user (`###STOP###` ends the dialog; its calls don't count toward player cost). `shared/sqlite.ts` wraps sql.js for both browser worker and Node. `registry.ts` auto-discovers `./p*/index.ts`. Stars: ★ core pass rate ≥ `passThreshold`, ★★ 100%, ★★★ 100% and tokens ≤ `tokenBudget`. **Read `docs/PROJECT_AUTHORING.md` before touching projects.**

**Mock models** must react to what the player actually sent (system prompt, tool schemas/descriptions, message content) — never script by `ctx.call` alone — so better player code earns better results. Helpers in `src/engine/llm/mock-kit.ts`.

**Integrity tests** (`tests/levels.test.ts`, `tests/projects.test.ts`) enforce: reference solution earns ★★★ in mock mode, starter fails (projects: 0 stars), file declarations are valid, and the final level workspace passes every level. Budgets are set to ~1.2× the reference solution's tokens.

**Exports**: `src/export/buildZip.ts` + `src/export/template/**` (graduation Node project), `src/projects/exportProject.ts` (per-project export with `npm test` = mock core set, `npm run bench` = real-model benchmark).

**UI (`src/features/`, `src/state/`)**: zustand stores — `state/progress.ts` (files, borrowed, level/project progress, persisted via idb-keyval) and `state/settings.ts`. Pages under `features/level`, `features/projects` (lazy-loaded); `features/editor/CompareView.tsx` shows reference solutions side-by-side / as a Monaco diff, using a separate `file:///reference/` model root so reference imports resolve. `window.__agentQuest.useProgress` is exposed for e2e tests.

## Gotchas

- `tsconfig.json` excludes `starter/`, `solution/` and `src/export/template/**` — those are raw strings loaded via `import.meta.glob(..., '?raw')`, type-checked inside the export verification instead.
- zustand selectors must not return fresh `?? []` / `?? {}` literals (infinite re-render); use module-level constants.
- Monaco is bundled locally (no CDN); `CodeEditor` uses `keepCurrentModel` and `syncModels()` owns model lifecycle. Effects that dispose models must survive React StrictMode's double-invoke.
- Sandbox-worker deps must be listed in `optimizeDeps` in `vite.config.ts`, otherwise the first run in dev triggers a full page reload.
