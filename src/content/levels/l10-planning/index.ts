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
  id: 'l10',
  number: 10,
  chapter: 3,
  title: L('规划', 'Planning'),
  tagline: L('先想清楚再动手：Plan-and-Execute', 'Think before you act: Plan-and-Execute'),
  concepts: L(['Plan-and-Execute', 'ReAct 对比', '步骤间传结果', '重新规划'], ['Plan-and-Execute', 'ReAct vs. planning', 'passing results between steps', 'replanning']),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      '规划就是第 2 关的结构化输出：`PlanSchema.safeParse(parseJsonLoose(textOf(res.content)))`，失败就把 `issues` 里的字段路径反馈给模型再试一次。',
      '执行提示：`用户的原始请求：${goal}\\n\\n已完成步骤的结果：\\n${done.map(r => `- [${r.id}] ${r.task}：${r.output}`).join("\\n")}\\n\\n当前步骤：${step.task}`——每一步都是一次全新的 `runAgent`。',
      '用一个队列执行步骤：`while (queue.length) { const step = queue.shift()! ... }`；失败时 `const next = await makePlan(含失败原因的请求, tools)`，再用 `queue.splice(0, queue.length, ...next.steps)` 换掉剩下的步骤。',
      '汇总：`chat({ system: SYNTH_SYSTEM, messages: [{ role: "user", content: 原始请求 + 每一步的结果 }] })`，返回 `{ plan, stepResults, output }`。',
    ],
    [
      'Planning is just level 2\'s structured output: `PlanSchema.safeParse(parseJsonLoose(textOf(res.content)))`; on failure, feed the field paths from `issues` back to the model and try again.',
      'Executor prompt: `The user\'s original request: ${goal}\\n\\nResults of completed steps:\\n${done.map(r => `- [${r.id}] ${r.task}: ${r.output}`).join("\\n")}\\n\\nCurrent step: ${step.task}`. Every step is a brand-new `runAgent`.',
      'Run the steps from a queue: `while (queue.length) { const step = queue.shift()! ... }`; on failure, `const next = await makePlan(request with the failure reason, tools)`, then swap out the remaining steps with `queue.splice(0, queue.length, ...next.steps)`.',
      'Synthesis: `chat({ system: SYNTH_SYSTEM, messages: [{ role: "user", content: original request + every step result }] })`, then return `{ plan, stepResults, output }`.',
    ],
  ),
  files: [{ path: 'planner.ts', starter: STARTER['planner.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
