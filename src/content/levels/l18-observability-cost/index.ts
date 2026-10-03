import { L } from '../../../engine/locale'
import { localizedFiles, rawFiles, type LevelDef } from '../../types'
import knowledgeEn from './knowledge.en.md?raw'
import knowledge from './knowledge.md?raw'
import storyEn from './story.en.md?raw'
import story from './story.md?raw'
import taskEn from './task.en.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = localizedFiles(
  rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
  rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
)


export const level: LevelDef = {
  id: 'l18',
  number: 18,
  chapter: 5,
  title: L('可观测性与成本', 'Observability & Cost'),
  tagline: L('看不见的钱最难省：埋点、归因、缓存、路由、预算', "You can't cut costs you can't see: tracing, attribution, caching, routing, budgets"),
  concepts: L(
    ['span 埋点', '按功能归因', '响应缓存', '模型路由', '预算守卫', '依赖注入'],
    ['Span tracing', 'Per-feature attribution', 'Response caching', 'Model routing', 'Budget guards', 'Dependency injection'],
  ),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      'agent.ts 只需两处改动：`AgentOptions` 加 `chat?: (req: ChatRequest) => Promise<ChatResponse>`；循环里用 `const callModel = opts.chat ?? chat`。',
      'instrument：`const start = now(); try { const res = await chatFn(req); tracer.record({ ..., latencyMs: now() - start, costUsd: costOf(res.model, res.usage) }); return res } catch (e) { tracer.record({ ..., error: e.message }); throw e }`',
      'stableKey：数组 `"[" + v.map(stableKey).join(",") + "]"`；对象先 `Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)` 再拼接。withCache 用 `Map<string, Promise<ChatResponse>>`，失败时 `store.delete(key)`。',
      'withBudget：`const estimate = costOf(req.model === "fast" ? "mock-fast" : "mock-default", { input_tokens: countTokens(req), output_tokens: 0 }); if (spent + estimate > maxUsd) throw new BudgetExceededError("预算超限：...")`；调用成功后 `spent += costOf(res.model, res.usage)`。',
    ],
    [
      'agent.ts needs only two changes: add `chat?: (req: ChatRequest) => Promise<ChatResponse>` to `AgentOptions`, and use `const callModel = opts.chat ?? chat` in the loop.',
      'instrument: `const start = now(); try { const res = await chatFn(req); tracer.record({ ..., latencyMs: now() - start, costUsd: costOf(res.model, res.usage) }); return res } catch (e) { tracer.record({ ..., error: e.message }); throw e }`',
      'stableKey: arrays become `"[" + v.map(stableKey).join(",") + "]"`; for objects, `Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)` first, then join. withCache uses a `Map<string, Promise<ChatResponse>>` and calls `store.delete(key)` on failure.',
      'withBudget: `const estimate = costOf(req.model === "fast" ? "mock-fast" : "mock-default", { input_tokens: countTokens(req), output_tokens: 0 }); if (spent + estimate > maxUsd) throw new BudgetExceededError("Budget exceeded: ...")`; after a successful call, `spent += costOf(res.model, res.usage)`.',
    ],
  ),
  files: [{ path: 'observability.ts', starter: starter['observability.ts'] }, { path: 'agent.ts' }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
