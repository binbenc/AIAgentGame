import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l16',
  number: 16,
  chapter: 5,
  title: '评测',
  tagline: '无法度量，就无法改进：每次改 prompt 之前，先跑一遍评测',
  concepts: ['评测集', '规则评分', 'LLM-as-judge', '并发上限', '回归检测'],
  story,
  task,
  knowledge,
  hints: [
    'includesAll：`const words = keywords ?? c.keywords; if (!words?.length) return null; const missing = words.filter(w => !output.includes(w))`，score = `(words.length - missing.length) / words.length`。',
    'llmJudge：user 消息写成 `<rubric>\\n${criteria}\\n</rubric>\\n\\n<output>\\n${output}\\n</output>`，system 要求只输出 `{"pass","score","reason"}`；解析放进 try/catch，失败就返回 `{ pass: false, score: 0, reason }`。',
    '工作池：`let next = 0; const worker = async () => { while (next < cases.length) { const i = next++; results[i] = await runCase(cases[i]) } }`，然后 `await Promise.all(Array.from({ length: concurrency }, worker))`。',
    'compareReports：先 `new Map(baseline.results.map(r => [r.id, r.passed]))`，再遍历 candidate.results 比较。',
  ],
  files: [{ path: 'evals.ts', starter: starter['evals.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
