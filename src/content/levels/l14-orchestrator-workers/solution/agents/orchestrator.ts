import { chat } from 'agent-quest'
import { z } from 'zod'
import { runAgent } from '../agent'
import { parseJsonLoose } from '../structured'
import { textOf, type Tool } from '../tools'

/** 工具集：名字 → 一组工具。编排者给每个子任务指定一个工具集 */
export type Toolsets = Record<string, Tool[]>

export const PlanSchema = z.object({
  subtasks: z
    .array(
      z.object({
        id: z.string().min(1),
        goal: z.string().min(1),
        toolset: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
})
export type Subtask = z.infer<typeof PlanSchema>['subtasks'][number]

export interface WorkerReport {
  id: string
  goal: string
  ok: boolean
  /** 精简后的要点摘要（不是完整对话记录） */
  summary: string
  error?: string
}

export interface ResearchReport {
  answer: string
  subtasks: Subtask[]
  workers: WorkerReport[]
  /** 有子任务失败时为 true：结果可用，但不完整 */
  partial: boolean
}

const PLANNER_SYSTEM = `你是调研编排者（orchestrator）。把用户的调研问题拆成 1~5 个互相独立、可以并行完成的子任务。
每个子任务只能使用一个工具集。只输出 JSON，不要输出其它文字，格式：
{"subtasks":[{"id":"英文短 id","goal":"这个子任务要查清楚什么（一句话）","toolset":"工具集名称"}]}`

const WORKER_SYSTEM = `你是调研工作者（worker），只负责一个子任务。用给你的工具收集信息，然后只返回一段不超过 200 字的要点摘要：
- 只写结论和关键数字，不要粘贴原始网页、规格表或评价原文；
- 查不到的信息直接说明，不要编造。`

const SYNTH_SYSTEM = `你是调研编排者，负责汇总。根据各子任务的要点摘要，写一份简洁的竞品调研简报，覆盖每一个子任务。
某个子任务失败时，要在简报里明确标注“数据缺失”，不要编造。`

/** 第一步：编排者拆解任务（结构化输出 + 校验） */
export async function plan(question: string, toolsets: Toolsets): Promise<Subtask[]> {
  const catalog = Object.entries(toolsets)
    .map(([name, tools]) => `- ${name}：${tools.map((t) => `${t.spec.name}（${t.spec.description}）`).join('；')}`)
    .join('\n')
  const res = await chat({
    system: PLANNER_SYSTEM,
    messages: [{ role: 'user', content: `调研问题：${question}\n\n可用的工具集：\n${catalog}` }],
  })
  const { subtasks } = PlanSchema.parse(parseJsonLoose(textOf(res.content)))
  for (const s of subtasks)
    if (!(s.toolset in toolsets)) throw new Error(`编排者给出了不存在的工具集 "${s.toolset}"`)
  return subtasks
}

/** 第二步：一个 worker = 一个全新的 Agent，独立上下文 + 受限工具集，只回传摘要 */
export async function runWorker(task: Subtask, tools: Tool[]): Promise<WorkerReport> {
  try {
    const r = await runAgent(`子任务：${task.goal}`, tools, { system: WORKER_SYSTEM, maxSteps: 6 })
    if (r.stopReason !== 'done' || !r.output.trim()) throw new Error('子任务没有在步数上限内完成')
    return { id: task.id, goal: task.goal, ok: true, summary: r.output }
  } catch (e) {
    // 单个 worker 失败不拖垮整体：记录下来，交给汇总阶段标注
    return { id: task.id, goal: task.goal, ok: false, summary: '', error: (e as Error).message }
  }
}

/** 第三步：编排者只看摘要，写最终答案 */
export async function synthesize(question: string, workers: WorkerReport[]): Promise<string> {
  const body = workers
    .map((w) =>
      w.ok ? `### 子任务 ${w.id}：${w.goal}\n${w.summary}` : `### 子任务 ${w.id}：${w.goal}\n（该子任务失败：${w.error}）`,
    )
    .join('\n\n')
  const res = await chat({
    system: SYNTH_SYSTEM,
    messages: [{ role: 'user', content: `调研问题：${question}\n\n各子任务的结果：\n\n${body}` }],
  })
  return textOf(res.content)
}

export async function research(question: string, toolsets: Toolsets): Promise<ResearchReport> {
  const subtasks = await plan(question, toolsets)
  // 并行：总耗时 ≈ 最慢的那个 worker
  const workers = await Promise.all(subtasks.map((s) => runWorker(s, toolsets[s.toolset])))
  if (workers.every((w) => !w.ok)) throw new Error(`所有子任务都失败了：${workers.map((w) => w.error).join('；')}`)
  const answer = await synthesize(question, workers)
  return { answer, subtasks, workers, partial: workers.some((w) => !w.ok) }
}
