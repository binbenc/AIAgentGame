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
  id: 'l09',
  number: 9,
  chapter: 2,
  title: L('RAG 检索增强', 'Retrieval (RAG)'),
  tagline: L('先检索再回答：有出处、不编造、不相关就不花钱', "Retrieve, then answer: cite sources, don't make things up, don't pay for off-topic questions"),
  concepts: L(['切块', 'BM25', '检索增强生成', '引用出处', '拒答阈值'], ['chunking', 'BM25', 'retrieval-augmented generation', 'citations', 'refusal threshold']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '切块：`step = size - overlap`，`for (let start = 0; ; start += step) { push(text.slice(start, start + size)); if (start + size >= text.length) break }`。',
      'BM25 单项得分：`idf × tf × (k1 + 1) / (tf + k1 × (1 - b + b × len / avgLen))`，`idf = ln(1 + (N - df + 0.5) / (df + 0.5))`。分词直接复用 `memory.ts` 的 `tokenize`。',
      'prompt：每块写成 `[${chunk.id}]\\n${chunk.text}`；system 里要求“每个结论后用 [文档id#块编号] 标注出处”“资料里没有答案就说没有，不要编造”。',
      '校验出处：`text.replace(/\\s*\\[([\\w-]+#\\d+)\\]/g, (m, id) => allowed.has(id) ? m : "")`，同时把合法的 id 收集进 citations。',
    ],
    [
      'Chunking: `step = size - overlap`, `for (let start = 0; ; start += step) { push(text.slice(start, start + size)); if (start + size >= text.length) break }`.',
      'BM25 per-term score: `idf × tf × (k1 + 1) / (tf + k1 × (1 - b + b × len / avgLen))`, with `idf = ln(1 + (N - df + 0.5) / (df + 0.5))`. Reuse `tokenize` from `memory.ts`.',
      'Prompt: write each chunk as `[${chunk.id}]\\n${chunk.text}`; the system prompt asks to "cite each claim as [doc-id#chunk]" and "if the docs do not have the answer, say so; do not make anything up".',
      'Checking citations: `text.replace(/\\s*\\[([\\w-]+#\\d+)\\]/g, (m, id) => allowed.has(id) ? m : "")`, collecting the valid ids into citations as you go.',
    ],
  ),
  files: [{ path: 'rag.ts', starter: STARTER['rag.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
