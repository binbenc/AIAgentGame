import { chat } from 'agent-quest'
import { z } from 'zod'
import { runAgent } from '../agent'
import { parseJsonLoose } from '../structured'
import { textOf, type Tool } from '../tools'

/** Toolsets: name → a group of tools. The orchestrator assigns one toolset to each subtask */
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
  /** A concise summary of the key points (not the full transcript) */
  summary: string
  error?: string
}

export interface ResearchReport {
  answer: string
  subtasks: Subtask[]
  workers: WorkerReport[]
  /** true when a subtask failed: the result is usable but incomplete */
  partial: boolean
}

/** Step 1: the orchestrator splits the task */
export async function plan(question: string, toolsets: Toolsets): Promise<Subtask[]> {
  // TODO:
  //   1. List the available toolsets in the prompt (name + each tool's name/description) and ask for JSON only:
  //      {"subtasks":[{"id":"...","goal":"...","toolset":"toolset name"}]}
  //   2. chat() → parseJsonLoose → PlanSchema.parse
  //   3. Check that every toolset exists in toolsets
  void chat
  void parseJsonLoose
  throw new Error('TODO: implement plan()')
}

/** Step 2: one worker = one brand-new agent */
export async function runWorker(task: Subtask, tools: Tool[]): Promise<WorkerReport> {
  // TODO:
  //   - runAgent(the subtask goal, only its own tools, { system: a worker prompt asking for "only a concise summary of the key points" })
  //   - success: { ok: true, summary: r.output }
  //   - error / didn't finish normally: don't throw, return { ok: false, summary: '', error }
  throw new Error('TODO: implement runWorker()')
}

/** Step 3: the orchestrator writes the final answer from the summaries only */
export async function synthesize(question: string, workers: WorkerReport[]): Promise<string> {
  // TODO: put each subtask's summary (for failed ones, "failed: <reason>") into one user message and call chat()
  throw new Error('TODO: implement synthesize()')
}

/**
 * Current implementation: one agent holds every tool and stuffs all the raw data into a single context.
 * Slow, expensive, and easily thrown off by noise. Turn it into orchestrator → parallel workers → synthesis.
 */
export async function research(question: string, toolsets: Toolsets): Promise<ResearchReport> {
  const allTools = Object.values(toolsets).flat()
  const r = await runAgent(question, allTools)
  // TODO: plan → Promise.all(runWorker) → synthesize; partial = true when a worker failed
  return { answer: r.output, subtasks: [], workers: [], partial: false }
}
