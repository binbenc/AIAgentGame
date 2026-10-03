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

function toolList(tools: Tool[]): string {
  return tools.map((t) => `- ${t.spec.name}：${t.spec.description}`).join('\n')
}

function describeResults(results: StepResult[]): string {
  if (!results.length) return '（无）'
  return results.map((r) => `- [${r.id}] ${r.task}${r.ok ? '' : '（失败）'}\n  结果：${r.output}`).join('\n')
}

/** 一次规划调用：只要 JSON 计划；不合法就带着校验错误重试 */
export async function makePlan(request: string, tools: Tool[], opts: PlanOptions = {}): Promise<Plan> {
  const system = `${PLANNER_SYSTEM}\n\n执行者可以使用的工具：\n${toolList(tools)}`
  const messages: Message[] = [{ role: 'user', content: request }]
  const retries = opts.planRetries ?? 1
  let lastError = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await withRetry(() => chat({ system, model: opts.model, messages, max_tokens: 1024 }), { retries: opts.retries ?? 3 })
    try {
      const parsed = PlanSchema.safeParse(parseJsonLoose(textOf(res.content)))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    } catch (e) {
      lastError = (e as Error).message
    }
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `计划格式不对：${lastError}。请修正后只输出 JSON。` })
  }
  throw new Error(`规划失败（已重试 ${retries} 次）：${lastError}`)
}

/** 执行单个步骤：全新的对话，只带上原始请求和之前步骤的“结果”，不带完整对话记录 */
async function runStep(goal: string, step: PlanStep, done: StepResult[], tools: Tool[], opts: PlanOptions): Promise<StepResult> {
  const prompt = `用户的原始请求：${goal}\n\n已完成步骤的结果：\n${describeResults(done)}\n\n当前步骤：${step.task}`
  const r = await runAgent(prompt, tools, { ...opts, system: opts.system ?? EXECUTOR_SYSTEM })
  const ok = r.stopReason === 'done' && !r.output.includes('步骤失败')
  return { id: step.id, task: step.task, ok, output: r.output || '步骤失败：超过最大步数仍未完成' }
}

export async function planAndExecute(goal: string, tools: Tool[], opts: PlanOptions = {}): Promise<PlanResult> {
  // 1. 先规划
  const plan = await makePlan(goal, tools, opts)
  const queue = [...plan.steps]
  const executed: PlanStep[] = []
  const stepResults: StepResult[] = []
  let replans = opts.maxReplans ?? 1

  // 2. 按顺序逐步执行
  while (queue.length) {
    const step = queue.shift()!
    const result = await runStep(goal, step, stepResults, tools, opts)
    executed.push(step)
    stepResults.push(result)

    // 3. 步骤失败：带着错误重新规划剩下的工作（只重规划有限次）
    if (!result.ok && replans > 0) {
      replans--
      const replanRequest = `用户的原始请求：${goal}

已完成步骤的结果：
${describeResults(stepResults)}

步骤 [${step.id}]「${step.task}」失败了，原因：${result.output}
原计划中还没执行的步骤：${queue.map((s) => s.task).join('；') || '（无）'}

请根据失败原因，为**剩下的工作**重新制定计划（不要重复已完成的步骤）。`
      const next = await makePlan(replanRequest, tools, opts)
      const base = Math.max(0, ...executed.map((s) => s.id))
      queue.splice(0, queue.length, ...next.steps.map((s, i) => ({ id: base + i + 1, task: s.task })))
    }
  }

  // 4. 汇总成一条回复
  const res = await withRetry(
    () =>
      chat({
        system: SYNTH_SYSTEM,
        model: opts.model,
        messages: [{ role: 'user', content: `用户的原始请求：${goal}\n\n各步骤的执行结果：\n${describeResults(stepResults)}` }],
      }),
    { retries: opts.retries ?? 3 },
  )
  return { plan: { steps: [...executed] }, stepResults, output: textOf(res.content) }
}
