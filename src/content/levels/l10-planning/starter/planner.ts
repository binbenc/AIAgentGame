import { chat, type Message } from 'agent-quest'
import { z } from 'zod'
import { runAgent, type AgentOptions } from './agent'
import { withRetry } from './resilience'
import { parseJsonLoose } from './structured'
import { textOf, type Tool } from './tools'

export const PlanSchema = z.object({
  steps: z
    .array(z.object({ id: z.number().int(), task: z.string().min(1) }))
    .min(1)
    .max(8),
})
export type Plan = z.infer<typeof PlanSchema>
export type PlanStep = Plan['steps'][number]

export interface StepResult {
  id: number
  task: string
  ok: boolean
  output: string
}

export interface PlanResult {
  plan: Plan
  stepResults: StepResult[]
  output: string
}

export interface PlanOptions extends AgentOptions {
  /** 计划 JSON 不合法时最多重试几次（默认 1） */
  planRetries?: number
  /** 步骤失败时最多重新规划几次（默认 1） */
  maxReplans?: number
}

export const PLANNER_SYSTEM = `你是 Nova 科技客服团队的任务规划器。把用户的请求拆成若干个可以逐个执行的步骤。
- 每一步只做一件事，并写清楚要用到的关键信息（邮箱、订单号等）。
- 步骤按执行顺序排列，后面的步骤可以依赖前面步骤的结果。
- 只输出一个 JSON 对象，不要输出任何其它文字，格式：{"steps": [{"id": 1, "task": "..."}]}`

export const EXECUTOR_SYSTEM = `你是 Nova 科技客服 Agent，负责执行计划中的**一个**步骤。
- 只完成“当前步骤”，不要去做其它步骤的事。
- 完成后用一两句话汇报结果；如果无法完成，以“步骤失败：”开头说明原因。`

export const SYNTH_SYSTEM = `你是 Nova 科技的客服。根据各步骤的执行结果，给用户写一条完整、友好的回复：
逐一回应用户提出的每个要求，不要遗漏，也不要编造结果里没有的信息。`

/** 一次规划调用：只要 JSON 计划；不合法就带着校验错误重试 */
export async function makePlan(request: string, tools: Tool[], opts: PlanOptions = {}): Promise<Plan> {
  // TODO：
  //   1. chat({ system: PLANNER_SYSTEM + 工具清单, messages: [{ role: 'user', content: request }] })——不要传 tools，规划阶段不执行任何工具
  //   2. parseJsonLoose + PlanSchema.safeParse 校验
  //   3. 不合法：push assistant(错误输出) + user(校验错误，要点名字段)，重试 planRetries 次；仍失败就抛错
  throw new Error('TODO：实现 makePlan()')
}

export async function planAndExecute(goal: string, tools: Tool[], opts: PlanOptions = {}): Promise<PlanResult> {
  // TODO：
  //   1. const plan = await makePlan(goal, tools, opts)
  //   2. 逐步执行：每一步调用一次 runAgent(prompt, tools, { ...opts, system: EXECUTOR_SYSTEM })
  //      prompt = 原始请求 + 之前步骤的「结果」（不是完整对话记录） + `当前步骤：${step.task}`
  //   3. 一步失败（stopReason 不是 'done'，或输出含“步骤失败”）：带着失败原因调用 makePlan 重新规划剩下的工作（最多 maxReplans 次）
  //   4. 最后一次 chat({ system: SYNTH_SYSTEM, ... })，把所有步骤结果汇总成给用户的回复
  throw new Error('TODO：实现 planAndExecute()')
}
