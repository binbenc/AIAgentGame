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

const EVALUATOR_SYSTEM = `你是严格的客服文案评审。你只负责评审，不负责改写。
逐条对照评分标准检查 <draft> 标签里的草稿，只输出 JSON，不要输出其它文字：
{"pass": 是否满足全部标准, "score": 0~10 的整数, "feedback": ["每条没满足的标准各写一条：问题是什么 + 应该怎么改"]}
全部满足时 feedback 为空数组。`

/** 生成者：第一稿只看需求；修改稿要同时看到上一版草稿和评审意见 */
export async function generate(brief: string, previous?: Round): Promise<string> {
  const content = previous
    ? `${brief}

上一版草稿：
<draft>
${previous.draft}
</draft>

评审意见（逐条修改，其它内容保持不变）：
${previous.verdict.feedback.map((f) => `- ${f}`).join('\n')}

请输出修改后的完整邮件。`
    : brief
  const res = await chat({ system: WRITER_SYSTEM, messages: [{ role: 'user', content }] })
  return textOf(res.content)
}

/** 评审者：独立的角色和提示词，明确的评分标准，输出经过校验的 JSON */
export async function evaluate(draft: string, rubric: string[], model?: ModelTier): Promise<Verdict> {
  const messages: Message[] = [
    {
      role: 'user',
      content: `评分标准：\n${rubric.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n<draft>\n${draft}\n</draft>`,
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
    // 看不懂的评审结果绝不能当成“通过”：把错误告诉它，重来一次
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `你的输出不是合法的评审 JSON（${lastError}）。请只输出 {"pass", "score", "feedback"} 格式的 JSON。` })
  }
  throw new Error(`评审输出无法解析：${lastError}`)
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
  // 达到轮数上限仍未通过：返回得分最高的一版（最后一版不一定最好）
  const best = history.reduce((a, b) => (b.verdict.score > a.verdict.score ? b : a))
  return { final: best.draft, passed: false, rounds: history.length, history }
}
