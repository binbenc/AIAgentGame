import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l18',
  number: 18,
  chapter: 5,
  title: '可观测性与成本',
  tagline: '看不见的钱最难省：埋点、归因、缓存、路由、预算',
  concepts: ['span 埋点', '按功能归因', '响应缓存', '模型路由', '预算守卫', '依赖注入'],
  story,
  task,
  knowledge,
  hints: [
    'agent.ts 只需两处改动：`AgentOptions` 加 `chat?: (req: ChatRequest) => Promise<ChatResponse>`；循环里用 `const callModel = opts.chat ?? chat`。',
    'instrument：`const start = now(); try { const res = await chatFn(req); tracer.record({ ..., latencyMs: now() - start, costUsd: costOf(res.model, res.usage) }); return res } catch (e) { tracer.record({ ..., error: e.message }); throw e }`',
    'stableKey：数组 `"[" + v.map(stableKey).join(",") + "]"`；对象先 `Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)` 再拼接。withCache 用 `Map<string, Promise<ChatResponse>>`，失败时 `store.delete(key)`。',
    'withBudget：`const estimate = costOf(req.model === "fast" ? "mock-fast" : "mock-default", { input_tokens: countTokens(req), output_tokens: 0 }); if (spent + estimate > maxUsd) throw new BudgetExceededError("预算超限：...")`；调用成功后 `spent += costOf(res.model, res.usage)`。',
  ],
  files: [{ path: 'observability.ts', starter: starter['observability.ts'] }, { path: 'agent.ts' }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
