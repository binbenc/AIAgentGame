import { L } from '../../../engine/locale'
import { localizedFiles, rawFiles, type LevelDef } from '../../types'
import knowledgeEn from './knowledge.en.md?raw'
import knowledge from './knowledge.md?raw'
import storyEn from './story.en.md?raw'
import story from './story.md?raw'
import taskEn from './task.en.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const STARTER = localizedFiles(
  rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
  rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
)

export const level: LevelDef = {
  id: 'l11',
  number: 11,
  chapter: 3,
  title: L('工作流 vs Agent', 'Workflows vs Agents'),
  tagline: L('路径已知时，写死的工作流更便宜、更快、更可控', 'When the path is known, a hard-coded workflow is cheaper, faster and easier to control'),
  concepts: L(['路由', '提示链', '程序化闸门', '并行化', '快模型'], ['routing', 'prompt chaining', 'programmatic gates', 'parallelization', 'fast model']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '分类：`const parsed = RouteSchema.safeParse(textOf(res.content).trim().toLowerCase()); return parsed.success ? parsed.data : "other"`。别忘了 `model: "fast"`。',
      '路由处理器里，order_status 和 refund 都不需要模型：`const s = await api.getShipping(id); return { route, reply: `订单 ${id} 由${s.carrier}承运，当前状态：${s.status}。` }`。',
      '闸门就是普通的 `if`：`if (!info.orderId) return { ok: false, reason: "缺少订单号" }`；`const bad = FORBIDDEN.find(w => draft.includes(w))`。',
      '并行：`const verdicts = await Promise.all(Object.entries(CHECKS).map(async ([name, q]) => { const res = await chat({ model: "fast", ... }); return /^\\s*YES/i.test(textOf(res.content)) ? name : null }))`。',
    ],
    [
      'Classify: `const parsed = RouteSchema.safeParse(textOf(res.content).trim().toLowerCase()); return parsed.success ? parsed.data : "other"`. Don\'t forget `model: "fast"`.',
      'In the route handlers, neither order_status nor refund needs the model: `const s = await api.getShipping(id); return { route, reply: `Order ${id} is with ${s.carrier}. Current status: ${s.status}.` }`.',
      'A gate is just an `if`: `if (!info.orderId) return { ok: false, reason: "Missing order number" }`; `const bad = FORBIDDEN.find(w => draft.toLowerCase().includes(w))`.',
      'Parallel: `const verdicts = await Promise.all(Object.entries(CHECKS).map(async ([name, q]) => { const res = await chat({ model: "fast", ... }); return /^\\s*YES/i.test(textOf(res.content)) ? name : null }))`.',
    ],
  ),
  files: [{ path: 'workflows.ts', starter: STARTER['workflows.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
