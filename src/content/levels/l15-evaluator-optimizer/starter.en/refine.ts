import { chat, type Message, type ModelTier } from 'agent-quest'
import { z } from 'zod'
import { parseJsonLoose } from './structured'
import { textOf } from './tools'

export const VerdictSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(10),
  feedback: z.array(z.string()),
})
export type Verdict = z.infer<typeof VerdictSchema>

export interface Round {
  draft: string
  verdict: Verdict
}

export interface RefineResult {
  /** The draft that passed review; if none passed, the highest-scoring one */
  final: string
  passed: boolean
  rounds: number
  history: Round[]
}

export interface RefineOptions {
  /** The rubric: every item must be specific and checkable */
  rubric: string[]
  maxRounds?: number
  /** The evaluator can use a cheaper model (e.g. 'fast'), as long as evals show it judges accurately */
  evaluatorModel?: ModelTier
}

const WRITER_SYSTEM = `You write customer emails for Nova Tech support. Write an email to the customer based on the brief, sincere and concise. Output only the email body, no explanations.`

/** Generator: the first draft sees only the brief; a revision also sees the previous draft and the reviewer's feedback */
export async function generate(brief: string, previous?: Round): Promise<string> {
  // TODO: when there's a previous round, the user message must include: the brief + the previous draft + each piece of feedback (previous.verdict.feedback)
  const res = await chat({ system: WRITER_SYSTEM, messages: [{ role: 'user', content: brief }] })
  return textOf(res.content)
}

/** Evaluator: its own role and prompt, a clear rubric, and validated JSON output */
export async function evaluate(draft: string, rubric: string[], model?: ModelTier): Promise<Verdict> {
  // TODO:
  //   1. A separate EVALUATOR_SYSTEM: check the draft against each rubric item and output only {"pass","score","feedback"} JSON
  //   2. User message: list every rubric item, and put the draft inside <draft>...</draft> tags
  //   3. Validate with parseJsonLoose + VerdictSchema; if invalid, feed the error back and try once more, then throw if it's still invalid
  void parseJsonLoose
  void ([] as Message[])
  throw new Error('TODO: implement evaluate()')
}

export async function writeWithReview(brief: string, opts: RefineOptions): Promise<RefineResult> {
  // Current implementation: write one draft and call it done, with no quality check at all.
  // TODO: loop for maxRounds (default 3) rounds: generate → evaluate → append to history; return as soon as one passes
  //       If none pass: return the highest-scoring draft with passed: false
  const draft = await generate(brief)
  return { final: draft, passed: true, rounds: 1, history: [] }
}
