import { chat, type ModelTier } from 'agent-quest'
import { z } from 'zod'
import { parseJsonLoose } from './structured'
import { textOf } from './tools'

export interface EvalCase {
  id: string
  input: string
  /** Reference answer (for exactMatch) */
  expected?: string
  /** Keywords that must appear (for includesAll) */
  keywords?: string[]
  /** Grading rubric (for llmJudge) */
  rubric?: string
}

/** The system under test: takes a question, returns an answer */
export type Target = (input: string) => Promise<string>

export interface Grade {
  pass: boolean
  /** 0 to 1 */
  score: number
  reason?: string
}

export interface Grader {
  name: string
  /** Return null when this grader doesn't apply to the case (e.g. the case has no expected) */
  grade(c: EvalCase, output: string): Grade | null | Promise<Grade | null>
}

export interface CaseResult {
  id: string
  passed: boolean
  scores: Record<string, number>
  output: string
  error?: string
}

export interface EvalReport {
  passRate: number
  results: CaseResult[]
  totals: { cases: number; passed: number; failed: number; errored: number }
}

export interface Comparison {
  regressions: string[]
  improvements: string[]
  deltaPassRate: number
}

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Example: the simplest possible grader. Model the other two on it */
export function exactMatch(): Grader {
  return {
    name: 'exact_match',
    grade(c, output) {
      if (c.expected === undefined) return null
      const pass = normalize(output) === normalize(c.expected)
      return { pass, score: pass ? 1 : 0, reason: pass ? undefined : `expected "${c.expected}"` }
    },
  }
}

export function includesAll(keywords?: string[]): Grader {
  // TODO: name is 'includes_all'; keywords = the keywords argument ?? c.keywords; if neither, return null
  //       pass = all present; score = fraction present; list the missing keywords in reason
  throw new Error('TODO: implement includesAll()')
}

export function llmJudge(rubric?: string, opts: { model?: ModelTier } = {}): Grader {
  // TODO: name is 'llm_judge'; rubric = the rubric argument ?? c.rubric; if neither, return null
  //   1. A dedicated judge system prompt: output only {"pass", "score" (0-1), "reason"} JSON
  //   2. The user message holds the question, <rubric>the rubric</rubric> and <output>the answer being graded</output>
  //   3. parseJsonLoose + zod validation; if the judge's output is invalid, fail (score 0) — don't throw
  void chat
  void z
  void parseJsonLoose
  void textOf
  throw new Error('TODO: implement llmJudge()')
}

export async function runEval(
  cases: EvalCase[],
  target: Target,
  graders: Grader[],
  opts: { concurrency?: number } = {},
): Promise<EvalReport> {
  // Current implementation: runs cases one by one, and a single error crashes the whole eval.
  // TODO:
  //   - At most opts.concurrency cases running at once (worker pool); keep results in the same order as cases
  //   - target throws: record { passed: false, scores: {}, output: '', error } for that case and carry on
  //   - Graders that return null (not applicable) are left out of scores; a case passes only if every applicable grader passes
  //   - totals: cases / passed / failed (didn't pass, no error) / errored
  const results: CaseResult[] = []
  for (const c of cases) {
    const output = await target(c.input)
    const scores: Record<string, number> = {}
    let passed = true
    for (const g of graders) {
      const grade = await g.grade(c, output)
      if (!grade) continue
      scores[g.name] = grade.score
      passed &&= grade.pass
    }
    results.push({ id: c.id, passed, scores, output })
  }
  const passed = results.filter((r) => r.passed).length
  return { passRate: passed / cases.length, results, totals: { cases: cases.length, passed, failed: cases.length - passed, errored: 0 } }
}

export function compareReports(baseline: EvalReport, candidate: EvalReport): Comparison {
  // TODO: line up by id; regressions = passed in baseline, not in candidate; improvements = the reverse; deltaPassRate = new - old
  throw new Error('TODO: implement compareReports()')
}
