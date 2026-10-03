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
  id: 'l16',
  number: 16,
  chapter: 5,
  title: L('评测', 'Evals'),
  tagline: L('无法度量，就无法改进：每次改 prompt 之前，先跑一遍评测', "You can't improve what you can't measure: run the evals before every prompt change"),
  concepts: L(['评测集', '规则评分', 'LLM-as-judge', '并发上限', '回归检测'], ['Eval sets', 'Rule-based grading', 'LLM-as-judge', 'Concurrency limits', 'Regression detection']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      'includesAll：`const words = keywords ?? c.keywords; if (!words?.length) return null; const missing = words.filter(w => !output.includes(w))`，score = `(words.length - missing.length) / words.length`。',
      'llmJudge：user 消息写成 `<rubric>\\n${criteria}\\n</rubric>\\n\\n<output>\\n${output}\\n</output>`，system 要求只输出 `{"pass","score","reason"}`；解析放进 try/catch，失败就返回 `{ pass: false, score: 0, reason }`。',
      '工作池：`let next = 0; const worker = async () => { while (next < cases.length) { const i = next++; results[i] = await runCase(cases[i]) } }`，然后 `await Promise.all(Array.from({ length: concurrency }, worker))`。',
      'compareReports：先 `new Map(baseline.results.map(r => [r.id, r.passed]))`，再遍历 candidate.results 比较。',
    ],
    [
      'includesAll: `const words = keywords ?? c.keywords; if (!words?.length) return null; const missing = words.filter(w => !output.includes(w))`, and score = `(words.length - missing.length) / words.length`.',
      'llmJudge: make the user message `<rubric>\\n${criteria}\\n</rubric>\\n\\n<output>\\n${output}\\n</output>`, and have the system prompt demand only `{"pass","score","reason"}`. Parse inside try/catch; on failure return `{ pass: false, score: 0, reason }`.',
      'Worker pool: `let next = 0; const worker = async () => { while (next < cases.length) { const i = next++; results[i] = await runCase(cases[i]) } }`, then `await Promise.all(Array.from({ length: concurrency }, worker))`.',
      'compareReports: build `new Map(baseline.results.map(r => [r.id, r.passed]))` first, then walk candidate.results and compare.',
    ],
  ),
  files: [{ path: 'evals.ts', starter: starter['evals.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
