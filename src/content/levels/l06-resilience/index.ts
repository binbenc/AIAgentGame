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
  id: 'l06',
  number: 6,
  chapter: 1,
  title: L('失败处理', 'Handling Failure'),
  tagline: L('外部依赖一定会失败，模型一定会出错', 'Dependencies will fail. The model will make mistakes.'),
  concepts: L(['指数退避', '可重试错误', '幻觉工具', '参数校验', '超时'], ['exponential backoff', 'retryable errors', 'hallucinated tools', 'argument validation', 'timeouts']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '退避：`Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.random() * baseDelayMs`，然后 `await sleep(delay)`。',
      'withTimeout：`const ac = new AbortController(); const t = sleep(ms, ac.signal).then(() => { throw new Error("超时") }); try { return await Promise.race([p, t]) } finally { ac.abort() }`',
      '参数校验：`typeof input === "object" && input !== null && !Array.isArray(input)`，再检查 `tool.spec.input_schema.required` 里的每个字段。',
    ],
    [
      'Backoff: `Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.random() * baseDelayMs`, then `await sleep(delay)`.',
      'withTimeout: `const ac = new AbortController(); const t = sleep(ms, ac.signal).then(() => { throw new Error(label + " timed out") }); try { return await Promise.race([p, t]) } finally { ac.abort() }`',
      'Argument check: `typeof input === "object" && input !== null && !Array.isArray(input)`, then check every field in `tool.spec.input_schema.required`.',
    ],
  ),
  files: [{ path: 'resilience.ts', starter: STARTER['resilience.ts'] }, { path: 'agent.ts' }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
