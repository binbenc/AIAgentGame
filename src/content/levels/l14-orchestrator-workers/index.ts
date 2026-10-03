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
  id: 'l14',
  number: 14,
  chapter: 4,
  title: L('编排者-工作者', 'Orchestrator-Workers'),
  tagline: L(
    '拆任务、并行干、只交摘要：多 Agent 的第一性原理是上下文隔离',
    'Split the task, work in parallel, hand back only summaries: the first principle of multi-agent systems is context isolation',
  ),
  concepts: L(
    ['orchestrator-workers', '子 Agent', '上下文隔离', '受限工具集', '并行', '部分失败'],
    ['orchestrator-workers', 'sub-agents', 'context isolation', 'restricted toolsets', 'parallelism', 'partial failure'],
  ),
  story: L(story, storyEn),
  task: L(task, taskEn),
  knowledge: L(knowledge, knowledgeEn),
  hints: L(
    [
      'plan：用 `Object.entries(toolsets)` 把每个工具集的名字和工具说明拼进 user 消息，要求只输出 `{"subtasks":[...]}`，然后 `PlanSchema.parse(parseJsonLoose(textOf(res.content)))`。',
      'worker：`runAgent("子任务：" + task.goal, toolsets[task.toolset], { system: WORKER_SYSTEM })`——字符串任务 = 全新的 messages，天然隔离。WORKER_SYSTEM 里写明“只返回不超过 200 字的要点摘要，不要粘贴原文”。',
      '并行 + 容错：`await Promise.all(subtasks.map(s => runWorker(s, toolsets[s.toolset])))`，runWorker 内部 try/catch，失败时返回 `{ ok: false, summary: "", error }` 而不是抛出。',
      '汇总：只拼 `w.summary`（失败的写成“子任务 reviews 失败：原因”），再调用一次 chat()；`partial = workers.some(w => !w.ok)`。',
    ],
    [
      'plan: use `Object.entries(toolsets)` to put each toolset\'s name and tool descriptions into the user message, ask for `{"subtasks":[...]}` only, then `PlanSchema.parse(parseJsonLoose(textOf(res.content)))`.',
      'worker: `runAgent("Subtask: " + task.goal, toolsets[task.toolset], { system: WORKER_SYSTEM })`. A string task = brand-new messages, isolated by construction. Have WORKER_SYSTEM say "return only a summary of the key points in under 150 words; don\'t paste raw data".',
      'Parallel + fault tolerance: `await Promise.all(subtasks.map(s => runWorker(s, toolsets[s.toolset])))`, with a try/catch inside runWorker that returns `{ ok: false, summary: "", error }` instead of throwing.',
      'Synthesis: join only the `w.summary`s (write failed ones as "Subtask reviews failed: <reason>"), then call chat() once more; `partial = workers.some(w => !w.ok)`.',
    ],
  ),
  files: [{ path: 'agents/orchestrator.ts', starter: STARTER['agents/orchestrator.ts'] }],
  solution: localizedFiles(
    rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
    rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
  ),
  suite,
}
