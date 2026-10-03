import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l06',
  number: 6,
  chapter: 1,
  title: '失败处理',
  tagline: '外部依赖一定会失败，模型一定会出错',
  concepts: ['指数退避', '可重试错误', '幻觉工具', '参数校验', '超时'],
  story,
  task,
  knowledge,
  hints: [
    '退避：`Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.random() * baseDelayMs`，然后 `await sleep(delay)`。',
    'withTimeout：`const ac = new AbortController(); const t = sleep(ms, ac.signal).then(() => { throw new Error("超时") }); try { return await Promise.race([p, t]) } finally { ac.abort() }`',
    '参数校验：`typeof input === "object" && input !== null && !Array.isArray(input)`，再检查 `tool.spec.input_schema.required` 里的每个字段。',
  ],
  files: [{ path: 'resilience.ts', starter: starter['resilience.ts'] }, { path: 'agent.ts' }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
