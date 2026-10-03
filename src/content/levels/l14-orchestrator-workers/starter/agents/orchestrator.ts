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

/** 第一步：编排者拆解任务 */
export async function plan(question: string, toolsets: Toolsets): Promise<Subtask[]> {
  // TODO：
  //   1. 在 prompt 里列出可用的工具集（名字 + 每个工具的 name/description），要求只输出 JSON：
  //      {"subtasks":[{"id":"...","goal":"...","toolset":"工具集名称"}]}
  //   2. chat() → parseJsonLoose → PlanSchema.parse
  //   3. 检查每个 toolset 都存在于 toolsets 里
  void chat
  void parseJsonLoose
  throw new Error('TODO：实现 plan()')
}

/** 第二步：一个 worker = 一个全新的 Agent */
export async function runWorker(task: Subtask, tools: Tool[]): Promise<WorkerReport> {
  // TODO：
  //   - runAgent(子任务目标, 只属于它的 tools, { system: 要求“只返回精简要点摘要”的 worker 提示词 })
  //   - 成功：{ ok: true, summary: r.output }
  //   - 出错 / 没正常结束：不要抛出，返回 { ok: false, summary: '', error }
  throw new Error('TODO：实现 runWorker()')
}

/** 第三步：编排者只根据摘要写最终答案 */
export async function synthesize(question: string, workers: WorkerReport[]): Promise<string> {
  // TODO：把每个子任务的摘要（失败的写明“失败：原因”）拼进一条 user 消息，调用 chat()
  throw new Error('TODO：实现 synthesize()')
}

/**
 * 现在的实现：一个 Agent 拿着所有工具，把所有原始数据都塞进同一个上下文。
 * 又慢、又贵、还容易被噪音带偏。把它改成 编排者 → 并行 worker → 汇总。
 */
export async function research(question: string, toolsets: Toolsets): Promise<ResearchReport> {
  const allTools = Object.values(toolsets).flat()
  const r = await runAgent(question, allTools)
  // TODO：plan → Promise.all(runWorker) → synthesize；有 worker 失败时 partial = true
  return { answer: r.output, subtasks: [], workers: [], partial: false }
}
