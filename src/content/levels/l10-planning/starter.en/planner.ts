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

/** One planning call: JSON plan only; if it's invalid, retry with the validation error */
export async function makePlan(request: string, tools: Tool[], opts: PlanOptions = {}): Promise<Plan> {
  // TODO:
  //   1. chat({ system: PLANNER_SYSTEM + the tool list, messages: [{ role: 'user', content: request }] }); don't pass tools, nothing runs during planning
  //   2. validate with parseJsonLoose + PlanSchema.safeParse
  //   3. if invalid: push assistant (the bad output) + user (the validation error, naming the field), retry planRetries times; throw if it still fails
  throw new Error('TODO: implement makePlan()')
}

export async function planAndExecute(goal: string, tools: Tool[], opts: PlanOptions = {}): Promise<PlanResult> {
  // TODO:
  //   1. const plan = await makePlan(goal, tools, opts)
  //   2. execute step by step: one runAgent(prompt, tools, { ...opts, system: EXECUTOR_SYSTEM }) per step
  //      prompt = the original request + the *results* of earlier steps (not their transcripts) + `Current step: ${step.task}`
  //   3. if a step fails (stopReason isn't 'done', or the output contains "Step failed"): call makePlan with the failure reason to replan the remaining work (at most maxReplans times)
  //   4. finish with one chat({ system: SYNTH_SYSTEM, ... }) that turns all step results into the reply to the user
  throw new Error('TODO: implement planAndExecute()')
}
