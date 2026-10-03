import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l15',
  number: 15,
  chapter: 4,
  title: '评审者-优化者',
  tagline: '一个写、一个挑刺：用明确的评分标准把质量循环起来',
  concepts: ['evaluator-optimizer', '评分标准（rubric）', '反馈回路', '轮数上限', '择优'],
  story,
  task,
  knowledge,
  hints: [
    '评审请求：user 消息里写 `评分标准：\\n1. ...\\n2. ...`，再把草稿放进 `<draft>\\n...\\n</draft>`；system 里要求只输出 `{"pass","score","feedback"}` 格式的 JSON。',
    '解析：`VerdictSchema.safeParse(parseJsonLoose(text))`；失败时 push assistant 回答 + 一条说明错误的 user 消息，再调用一次（和第 2 关的自我修正一样）。',
    '修改稿：`generate(brief, history.at(-1))`，有上一轮时把 `previous.draft` 和 `previous.verdict.feedback` 逐条拼进 user 消息。',
    '择优：`history.reduce((a, b) => (b.verdict.score > a.verdict.score ? b : a))`。',
  ],
  files: [{ path: 'refine.ts', starter: starter['refine.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
