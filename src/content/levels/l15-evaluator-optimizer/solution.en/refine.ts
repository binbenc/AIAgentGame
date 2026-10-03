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

const EVALUATOR_SYSTEM = `You are a strict reviewer of customer support emails. You only review; you don't rewrite.
Check the draft inside the <draft> tags against each rubric item, and output only JSON, nothing else:
{"pass": whether every item is met, "score": an integer from 0 to 10, "feedback": ["one entry per unmet item: what's wrong + how to fix it"]}
If every item is met, feedback is an empty array.`

/** Generator: the first draft sees only the brief; a revision also sees the previous draft and the reviewer's feedback */
export async function generate(brief: string, previous?: Round): Promise<string> {
  const content = previous
    ? `${brief}

Previous draft:
<draft>
${previous.draft}
</draft>

Reviewer comments (address each one, keep everything else unchanged):
${previous.verdict.feedback.map((f) => `- ${f}`).join('\n')}

Output the full revised email.`
    : brief
  const res = await chat({ system: WRITER_SYSTEM, messages: [{ role: 'user', content }] })
  return textOf(res.content)
}

/** Evaluator: its own role and prompt, a clear rubric, and validated JSON output */
export async function evaluate(draft: string, rubric: string[], model?: ModelTier): Promise<Verdict> {
  const messages: Message[] = [
    {
      role: 'user',
      content: `Rubric:\n${rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n<draft>\n${draft}\n</draft>`,
    },
  ]
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ system: EVALUATOR_SYSTEM, model, messages, max_tokens: 1024 })
    try {
      const parsed = VerdictSchema.safeParse(parseJsonLoose(textOf(res.content)))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    } catch (e) {
      lastError = (e as Error).message
    }
    // An unreadable verdict must never count as a pass: tell it what went wrong and try again
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `Your output was not valid review JSON (${lastError}). Output only JSON in the {"pass", "score", "feedback"} format.` })
  }
  throw new Error(`Could not parse the evaluator output: ${lastError}`)
}

export async function writeWithReview(brief: string, opts: RefineOptions): Promise<RefineResult> {
  const maxRounds = opts.maxRounds ?? 3
  const history: Round[] = []
  for (let i = 0; i < maxRounds; i++) {
    const draft = await generate(brief, history.at(-1))
    const verdict = await evaluate(draft, opts.rubric, opts.evaluatorModel)
    history.push({ draft, verdict })
    if (verdict.pass) return { final: draft, passed: true, rounds: history.length, history }
  }
  // Hit the round limit without passing: return the highest-scoring draft (the last one isn't necessarily the best)
  const best = history.reduce((a, b) => (b.verdict.score > a.verdict.score ? b : a))
  return { final: best.draft, passed: false, rounds: history.length, history }
}
