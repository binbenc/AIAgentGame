import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l11',
  number: 11,
  chapter: 3,
  title: '工作流 vs Agent',
  tagline: '路径已知时，写死的工作流更便宜、更快、更可控',
  concepts: ['路由', '提示链', '程序化闸门', '并行化', '快模型'],
  story,
  task,
  knowledge,
  hints: [
    '分类：`const parsed = RouteSchema.safeParse(textOf(res.content).trim().toLowerCase()); return parsed.success ? parsed.data : "other"`。别忘了 `model: "fast"`。',
    '路由处理器里，order_status 和 refund 都不需要模型：`const s = await api.getShipping(id); return { route, reply: `订单 ${id} 由${s.carrier}承运，当前状态：${s.status}。` }`。',
    '闸门就是普通的 `if`：`if (!info.orderId) return { ok: false, reason: "缺少订单号" }`；`const bad = FORBIDDEN.find(w => draft.includes(w))`。',
    '并行：`const verdicts = await Promise.all(Object.entries(CHECKS).map(async ([name, q]) => { const res = await chat({ model: "fast", ... }); return /^\\s*YES/i.test(textOf(res.content)) ? name : null }))`。',
  ],
  files: [{ path: 'workflows.ts', starter: starter['workflows.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
