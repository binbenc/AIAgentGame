import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l10',
  number: 10,
  chapter: 3,
  title: '规划',
  tagline: '先想清楚再动手：Plan-and-Execute',
  concepts: ['Plan-and-Execute', 'ReAct 对比', '步骤间传结果', '重新规划'],
  story,
  task,
  knowledge,
  hints: [
    '规划就是第 2 关的结构化输出：`PlanSchema.safeParse(parseJsonLoose(textOf(res.content)))`，失败就把 `issues` 里的字段路径反馈给模型再试一次。',
    '执行提示：`用户的原始请求：${goal}\\n\\n已完成步骤的结果：\\n${done.map(r => `- [${r.id}] ${r.task}：${r.output}`).join("\\n")}\\n\\n当前步骤：${step.task}`——每一步都是一次全新的 `runAgent`。',
    '用一个队列执行步骤：`while (queue.length) { const step = queue.shift()! ... }`；失败时 `const next = await makePlan(含失败原因的请求, tools)`，再用 `queue.splice(0, queue.length, ...next.steps)` 换掉剩下的步骤。',
    '汇总：`chat({ system: SYNTH_SYSTEM, messages: [{ role: "user", content: 原始请求 + 每一步的结果 }] })`，返回 `{ plan, stepResults, output }`。',
  ],
  files: [{ path: 'planner.ts', starter: starter['planner.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
