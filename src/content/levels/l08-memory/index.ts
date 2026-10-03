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
  id: 'l08',
  number: 8,
  chapter: 2,
  title: L('长期记忆', 'Long-Term Memory'),
  tagline: L('会话结束了，用户的偏好不该跟着消失', "The session ended. The user's preferences shouldn't vanish with it."),
  concepts: L(['长期记忆', '记忆工具', '记忆召回', '用户隔离', '敏感信息过滤'], ['long-term memory', 'memory tools', 'memory recall', 'user isolation', 'secret filtering']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '分词：`for (const [run] of text.toLowerCase().matchAll(/[a-z0-9]+|[\\u4e00-\\u9fff]+/g))`，中文片段用 `run.slice(i, i + 2)` 拆成二元组。',
      'recall：先 `filter(m => m.userId === userId)`，再数 query 的词有几个出现在 fact 的词里，`filter(score > 0)`、降序、`slice(0, k)`。',
      '敏感信息：`/\\d(?:[\\s-]?\\d){12,18}/` 能抓住带空格或横线的卡号和身份证号；在 `remember()` 里直接 `throw`，Agent 会把它变成 is_error 结果交给模型。',
      'chatWithMemory：`const mem = store.recall(userId, message, 3)` → `buildSystemWithMemories(base, mem)` → `runAgent(message, [...tools, ...createMemoryTools(store, userId)], { system })`。',
    ],
    [
      'Tokenizing: `for (const [run] of text.toLowerCase().matchAll(/[a-z0-9]+|[\\u4e00-\\u9fff]+/g))`; English words and numbers stay whole, Chinese runs become bigrams with `run.slice(i, i + 2)`.',
      "recall: first `filter(m => m.userId === userId)`, then count how many query tokens appear in the fact's tokens; `filter(score > 0)`, sort descending, `slice(0, k)`.",
      'Secrets: `/\\d(?:[\\s-]?\\d){12,18}/` catches card and ID numbers with spaces or dashes. Just `throw` in `remember()`; the agent turns it into an is_error result for the model.',
      'chatWithMemory: `const mem = store.recall(userId, message, 3)` → `buildSystemWithMemories(base, mem)` → `runAgent(message, [...tools, ...createMemoryTools(store, userId)], { system })`.',
    ],
  ),
  files: [{ path: 'memory.ts', starter: STARTER['memory.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
