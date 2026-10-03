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
  /** 通过评审的稿子；始终没通过时，是得分最高的那一版 */
  final: string
  passed: boolean
  rounds: number
  history: Round[]
}

export interface RefineOptions {
  /** 评分标准：每一条都要具体、可检查 */
  rubric: string[]
  maxRounds?: number
  /** 评审可以用更便宜的模型（例如 'fast'），前提是评测证明它判得准 */
  evaluatorModel?: ModelTier
}

const WRITER_SYSTEM = `你是 Nova 科技的客服文案。根据需求写一封给客户的邮件，语气真诚、简洁。只输出邮件正文，不要输出任何解释。`

/** 生成者：第一稿只看需求；修改稿要同时看到上一版草稿和评审意见 */
export async function generate(brief: string, previous?: Round): Promise<string> {
  // TODO：有 previous 时，user 消息里要带上：需求 + 上一版草稿 + 逐条评审意见（previous.verdict.feedback）
  const res = await chat({ system: WRITER_SYSTEM, messages: [{ role: 'user', content: brief }] })
  return textOf(res.content)
}

/** 评审者：独立的角色和提示词，明确的评分标准，输出经过校验的 JSON */
export async function evaluate(draft: string, rubric: string[], model?: ModelTier): Promise<Verdict> {
  // TODO：
  //   1. 单独的 EVALUATOR_SYSTEM：要求逐条对照评分标准，只输出 {"pass","score","feedback"} JSON
  //   2. user 消息：列出每一条 rubric，草稿放在 <draft>...</draft> 标签里
  //   3. parseJsonLoose + VerdictSchema 校验；不合法时把错误反馈给模型再试一次，仍不合法就抛错
  void parseJsonLoose
  void ([] as Message[])
  throw new Error('TODO：实现 evaluate()')
}

export async function writeWithReview(brief: string, opts: RefineOptions): Promise<RefineResult> {
  // 现在的实现：写一稿就交差，没有任何质量把关。
  // TODO：循环 maxRounds（默认 3）轮：generate → evaluate → 记入 history；通过就返回
  //       全部没通过：返回得分最高的那一版，passed: false
  const draft = await generate(brief)
  return { final: draft, passed: true, rounds: 1, history: [] }
}
