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
  id: 'l15',
  number: 15,
  chapter: 4,
  title: L('评审者-优化者', 'Evaluator-Optimizer'),
  tagline: L('一个写、一个挑刺：用明确的评分标准把质量循环起来', 'One writes, one critiques: loop quality upward with a clear rubric'),
  concepts: L(
    ['evaluator-optimizer', '评分标准（rubric）', '反馈回路', '轮数上限', '择优'],
    ['evaluator-optimizer', 'rubric', 'feedback loop', 'round limit', 'best-of selection'],
  ),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '评审请求：user 消息里写 `评分标准：\\n1. ...\\n2. ...`，再把草稿放进 `<draft>\\n...\\n</draft>`；system 里要求只输出 `{"pass","score","feedback"}` 格式的 JSON。',
      '解析：`VerdictSchema.safeParse(parseJsonLoose(text))`；失败时 push assistant 回答 + 一条说明错误的 user 消息，再调用一次（和第 2 关的自我修正一样）。',
      '修改稿：`generate(brief, history.at(-1))`，有上一轮时把 `previous.draft` 和 `previous.verdict.feedback` 逐条拼进 user 消息。',
      '择优：`history.reduce((a, b) => (b.verdict.score > a.verdict.score ? b : a))`。',
    ],
    [
      'Evaluation request: write `Rubric:\\n1. ...\\n2. ...` in the user message, then put the draft in `<draft>\\n...\\n</draft>`; in the system prompt, ask for JSON only, in the `{"pass","score","feedback"}` format.',
      'Parsing: `VerdictSchema.safeParse(parseJsonLoose(text))`; on failure, push the assistant reply + a user message explaining the error, and call again (the same self-correction as Level 2).',
      'Revisions: `generate(brief, history.at(-1))`; when there\'s a previous round, put `previous.draft` and each item of `previous.verdict.feedback` into the user message.',
      'Pick the best: `history.reduce((a, b) => (b.verdict.score > a.verdict.score ? b : a))`.',
    ],
  ),
  files: [{ path: 'refine.ts', starter: STARTER['refine.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
