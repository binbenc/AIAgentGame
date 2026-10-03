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
  /** Max retries when the plan JSON is invalid (default 1) */
  planRetries?: number
  /** Max replans when a step fails (default 1) */
  maxReplans?: number
}

export const PLANNER_SYSTEM = `You are the task planner for the Nova Tech support team. Break the user's request into steps that can be executed one at a time.
- Each step does exactly one thing and spells out the key details it needs (email, order id, etc.).
- List the steps in execution order; later steps may depend on the results of earlier ones.
- Output a single JSON object and nothing else, in this format: {"steps": [{"id": 1, "task": "..."}]}`

export const EXECUTOR_SYSTEM = `You are a Nova Tech support agent executing **one** step of a plan.
- Do only the "Current step"; don't do the work of other steps.
- When done, report the result in a sentence or two. If you can't complete it, start your reply with "Step failed:" and explain why.`

export const SYNTH_SYSTEM = `You are Nova Tech customer support. Using the results of each step, write the user one complete, friendly reply:
address every request the user made, one by one. Don't skip any, and don't make up anything that isn't in the results.`

function toolList(tools: Tool[]): string {
  return tools.map((t) => `- ${t.spec.name}: ${t.spec.description}`).join('\n')
}

function describeResults(results: StepResult[]): string {
  if (!results.length) return '(none)'
  return results.map((r) => `- [${r.id}] ${r.task}${r.ok ? '' : ' (failed)'}\n  Result: ${r.output}`).join('\n')
}

/** One planning call: JSON plan only; if it's invalid, retry with the validation error */
export async function makePlan(request: string, tools: Tool[], opts: PlanOptions = {}): Promise<Plan> {
  const system = `${PLANNER_SYSTEM}\n\nTools available to the executor:\n${toolList(tools)}`
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
    messages.push({ role: 'user', content: `The plan is invalid: ${lastError}. Fix it and output only the JSON.` })
  }
  throw new Error(`Planning failed (after ${retries} retries): ${lastError}`)
}

/** Execute one step: a fresh conversation with only the original request and earlier steps' results, never full transcripts */
async function runStep(goal: string, step: PlanStep, done: StepResult[], tools: Tool[], opts: PlanOptions): Promise<StepResult> {
  const prompt = `The user's original request: ${goal}\n\nResults of completed steps:\n${describeResults(done)}\n\nCurrent step: ${step.task}`
  const r = await runAgent(prompt, tools, { ...opts, system: opts.system ?? EXECUTOR_SYSTEM })
  const ok = r.stopReason === 'done' && !r.output.includes('Step failed')
  return { id: step.id, task: step.task, ok, output: r.output || 'Step failed: hit the step limit without finishing' }
}

export async function planAndExecute(goal: string, tools: Tool[], opts: PlanOptions = {}): Promise<PlanResult> {
  // 1. Plan first
  const plan = await makePlan(goal, tools, opts)
  const queue = [...plan.steps]
  const executed: PlanStep[] = []
  const stepResults: StepResult[] = []
  let replans = opts.maxReplans ?? 1

  // 2. Execute the steps in order
  while (queue.length) {
    const step = queue.shift()!
    const result = await runStep(goal, step, stepResults, tools, opts)
    executed.push(step)
    stepResults.push(result)

    // 3. A step failed: replan the remaining work with the error (a limited number of times)
    if (!result.ok && replans > 0) {
      replans--
      const replanRequest = `The user's original request: ${goal}

Results of completed steps:
${describeResults(stepResults)}

Step [${step.id}] "${step.task}" failed. Reason: ${result.output}
Steps from the original plan not yet executed: ${queue.map((s) => s.task).join('; ') || '(none)'}

Based on the failure reason, make a new plan for the **remaining work** (don't repeat completed steps).`
      const next = await makePlan(replanRequest, tools, opts)
      const base = Math.max(0, ...executed.map((s) => s.id))
      queue.splice(0, queue.length, ...next.steps.map((s, i) => ({ id: base + i + 1, task: s.task })))
    }
  }

  // 4. Synthesize a single reply
  const res = await withRetry(
    () =>
      chat({
        system: SYNTH_SYSTEM,
        model: opts.model,
        messages: [{ role: 'user', content: `The user's original request: ${goal}\n\nResults of each step:\n${describeResults(stepResults)}` }],
      }),
    { retries: opts.retries ?? 3 },
  )
  return { plan: { steps: [...executed] }, stepResults, output: textOf(res.content) }
}
