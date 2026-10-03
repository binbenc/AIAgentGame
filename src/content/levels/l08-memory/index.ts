import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l08',
  number: 8,
  chapter: 2,
  title: '长期记忆',
  tagline: '会话结束了，用户的偏好不该跟着消失',
  concepts: ['长期记忆', '记忆工具', '记忆召回', '用户隔离', '敏感信息过滤'],
  story,
  task,
  knowledge,
  hints: [
    '分词：`for (const [run] of text.toLowerCase().matchAll(/[a-z0-9]+|[\\u4e00-\\u9fff]+/g))`，中文片段用 `run.slice(i, i + 2)` 拆成二元组。',
    'recall：先 `filter(m => m.userId === userId)`，再数 query 的词有几个出现在 fact 的词里，`filter(score > 0)`、降序、`slice(0, k)`。',
    '敏感信息：`/\\d(?:[\\s-]?\\d){12,18}/` 能抓住带空格或横线的卡号和身份证号；在 `remember()` 里直接 `throw`，Agent 会把它变成 is_error 结果交给模型。',
    'chatWithMemory：`const mem = store.recall(userId, message, 3)` → `buildSystemWithMemories(base, mem)` → `runAgent(message, [...tools, ...createMemoryTools(store, userId)], { system })`。',
  ],
  files: [{ path: 'memory.ts', starter: starter['memory.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
