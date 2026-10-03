import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l09',
  number: 9,
  chapter: 2,
  title: 'RAG 检索增强',
  tagline: '先检索再回答：有出处、不编造、不相关就不花钱',
  concepts: ['切块', 'BM25', '检索增强生成', '引用出处', '拒答阈值'],
  story,
  task,
  knowledge,
  hints: [
    '切块：`step = size - overlap`，`for (let start = 0; ; start += step) { push(text.slice(start, start + size)); if (start + size >= text.length) break }`。',
    'BM25 单项得分：`idf × tf × (k1 + 1) / (tf + k1 × (1 - b + b × len / avgLen))`，`idf = ln(1 + (N - df + 0.5) / (df + 0.5))`。分词直接复用 `memory.ts` 的 `tokenize`。',
    'prompt：每块写成 `[${chunk.id}]\\n${chunk.text}`；system 里要求“每个结论后用 [文档id#块编号] 标注出处”“资料里没有答案就说没有，不要编造”。',
    '校验出处：`text.replace(/\\s*\\[([\\w-]+#\\d+)\\]/g, (m, id) => allowed.has(id) ? m : "")`，同时把合法的 id 收集进 citations。',
  ],
  files: [{ path: 'rag.ts', starter: starter['rag.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
