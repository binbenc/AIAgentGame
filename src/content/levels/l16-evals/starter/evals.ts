import { chat, type ModelTier } from 'agent-quest'
import { z } from 'zod'
import { parseJsonLoose } from './structured'
import { textOf } from './tools'

export interface EvalCase {
  id: string
  input: string
  /** 标准答案（exactMatch 用） */
  expected?: string
  /** 必须出现的关键词（includesAll 用） */
  keywords?: string[]
  /** 评分标准（llmJudge 用） */
  rubric?: string
}

/** 被评测的对象：输入一个问题，输出一段回答 */
export type Target = (input: string) => Promise<string>

export interface Grade {
  pass: boolean
  /** 0 ~ 1 */
  score: number
  reason?: string
}

export interface Grader {
  name: string
  /** 返回 null 表示这个评分器不适用于这条用例（例如用例没有 expected） */
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

/** 示例：最简单的评分器。照着它的样子写另外两个 */
export function exactMatch(): Grader {
  return {
    name: 'exact_match',
    grade(c, output) {
      if (c.expected === undefined) return null
      const pass = normalize(output) === normalize(c.expected)
      return { pass, score: pass ? 1 : 0, reason: pass ? undefined : `期望“${c.expected}”` }
    },
  }
}

export function includesAll(keywords?: string[]): Grader {
  // TODO：name 为 'includes_all'；关键词 = 参数 keywords ?? c.keywords，都没有就返回 null
  //       pass = 全部出现；score = 出现的比例；reason 里列出缺少的关键词
  throw new Error('TODO：实现 includesAll()')
}

export function llmJudge(rubric?: string, opts: { model?: ModelTier } = {}): Grader {
  // TODO：name 为 'llm_judge'；评分标准 = 参数 rubric ?? c.rubric，都没有就返回 null
  //   1. 独立的评委 system 提示词：只输出 {"pass", "score"(0~1), "reason"} JSON
  //   2. user 消息里放问题、<rubric>评分标准</rubric>、<output>被评回答</output>
  //   3. parseJsonLoose + zod 校验；评委输出不合法时判为不通过（score 0），不要抛出
  void chat
  void z
  void parseJsonLoose
  void textOf
  throw new Error('TODO：实现 llmJudge()')
}

export async function runEval(
  cases: EvalCase[],
  target: Target,
  graders: Grader[],
  opts: { concurrency?: number } = {},
): Promise<EvalReport> {
  // 现在的实现：一个接一个地跑，任何一条出错整个评测就崩了。
  // TODO：
  //   - 最多 opts.concurrency 条用例同时在跑（工作池），results 保持和 cases 相同的顺序
  //   - target 抛错：这条用例记为 { passed: false, scores: {}, output: '', error }，其它用例照常
  //   - 不适用（返回 null）的评分器不计入 scores；所有适用的评分器都通过，用例才算通过
  //   - totals：cases / passed / failed（没通过且没出错）/ errored
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
  // TODO：按 id 对齐；regressions = 基线通过、新版没通过；improvements 反之；deltaPassRate = 新 - 旧
  throw new Error('TODO：实现 compareReports()')
}
