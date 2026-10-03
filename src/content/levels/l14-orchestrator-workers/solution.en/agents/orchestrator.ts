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

const PLANNER_SYSTEM = `You are a research orchestrator. Split the user's research question into 1–5 independent subtasks that can run in parallel.
Each subtask may use only one toolset. Output only JSON, nothing else, in this format:
{"subtasks":[{"id":"short id","goal":"what this subtask needs to find out (one sentence)","toolset":"toolset name"}]}`

const WORKER_SYSTEM = `You are a research worker responsible for a single subtask. Gather information with the tools you're given, then return only a summary of the key points in under 150 words:
- conclusions and key numbers only; don't paste raw pages, spec tables or the original user comments;
- if you can't find something, say so; don't make anything up.`

const SYNTH_SYSTEM = `You are the research orchestrator, now writing up the results. From each subtask's key-point summary, write a concise competitive research brief that covers every subtask.
If a subtask failed, clearly mark it as "data missing" in the brief; don't make anything up.`

/** Step 1: the orchestrator splits the task (structured output + validation) */
export async function plan(question: string, toolsets: Toolsets): Promise<Subtask[]> {
  const catalog = Object.entries(toolsets)
    .map(([name, tools]) => `- ${name}: ${tools.map((t) => `${t.spec.name} (${t.spec.description})`).join('; ')}`)
    .join('\n')
  const res = await chat({
    system: PLANNER_SYSTEM,
    messages: [{ role: 'user', content: `Research question: ${question}\n\nAvailable toolsets:\n${catalog}` }],
  })
  const { subtasks } = PlanSchema.parse(parseJsonLoose(textOf(res.content)))
  for (const s of subtasks)
    if (!(s.toolset in toolsets)) throw new Error(`The orchestrator picked a toolset that doesn't exist: "${s.toolset}"`)
  return subtasks
}

/** Step 2: one worker = one brand-new agent, with its own context + a restricted toolset, returning only a summary */
export async function runWorker(task: Subtask, tools: Tool[]): Promise<WorkerReport> {
  try {
    const r = await runAgent(`Subtask: ${task.goal}`, tools, { system: WORKER_SYSTEM, maxSteps: 6 })
    if (r.stopReason !== 'done' || !r.output.trim()) throw new Error('The subtask did not finish within the step limit')
    return { id: task.id, goal: task.goal, ok: true, summary: r.output }
  } catch (e) {
    // One failing worker doesn't take down the whole run: record it and let the synthesis step flag it
    return { id: task.id, goal: task.goal, ok: false, summary: '', error: (e as Error).message }
  }
}

/** Step 3: the orchestrator reads only the summaries and writes the final answer */
export async function synthesize(question: string, workers: WorkerReport[]): Promise<string> {
  const body = workers
    .map((w) =>
      w.ok ? `### Subtask ${w.id}: ${w.goal}\n${w.summary}` : `### Subtask ${w.id}: ${w.goal}\n(This subtask failed: ${w.error})`,
    )
    .join('\n\n')
  const res = await chat({
    system: SYNTH_SYSTEM,
    messages: [{ role: 'user', content: `Research question: ${question}\n\nResults of each subtask:\n\n${body}` }],
  })
  return textOf(res.content)
}

export async function research(question: string, toolsets: Toolsets): Promise<ResearchReport> {
  const subtasks = await plan(question, toolsets)
  // Parallel: total time ≈ the slowest worker
  const workers = await Promise.all(subtasks.map((s) => runWorker(s, toolsets[s.toolset])))
  if (workers.every((w) => !w.ok)) throw new Error(`Every subtask failed: ${workers.map((w) => w.error).join('; ')}`)
  const answer = await synthesize(question, workers)
  return { answer, subtasks, workers, partial: workers.some((w) => !w.ok) }
}
