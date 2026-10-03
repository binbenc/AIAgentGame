import { rawFiles, type LevelDef } from '../../types'
import knowledge from './knowledge.md?raw'
import story from './story.md?raw'
import task from './task.md?raw'
import { suite } from './suite'

const starter = rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')

export const level: LevelDef = {
  id: 'l14',
  number: 14,
  chapter: 4,
  title: '编排者-工作者',
  tagline: '拆任务、并行干、只交摘要：多 Agent 的第一性原理是上下文隔离',
  concepts: ['orchestrator-workers', '子 Agent', '上下文隔离', '受限工具集', '并行', '部分失败'],
  story,
  task,
  knowledge,
  hints: [
    'plan：用 `Object.entries(toolsets)` 把每个工具集的名字和工具说明拼进 user 消息，要求只输出 `{"subtasks":[...]}`，然后 `PlanSchema.parse(parseJsonLoose(textOf(res.content)))`。',
    'worker：`runAgent("子任务：" + task.goal, toolsets[task.toolset], { system: WORKER_SYSTEM })`——字符串任务 = 全新的 messages，天然隔离。WORKER_SYSTEM 里写明“只返回不超过 200 字的要点摘要，不要粘贴原文”。',
    '并行 + 容错：`await Promise.all(subtasks.map(s => runWorker(s, toolsets[s.toolset])))`，runWorker 内部 try/catch，失败时返回 `{ ok: false, summary: "", error }` 而不是抛出。',
    '汇总：只拼 `w.summary`（失败的写成“子任务 reviews 失败：原因”），再调用一次 chat()；`partial = workers.some(w => !w.ok)`。',
  ],
  files: [{ path: 'agents/orchestrator.ts', starter: starter['agents/orchestrator.ts'] }],
  solution: rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
  suite,
}
