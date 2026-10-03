import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'
import { __delay, __traced } from '../../../engine/runtime/api'

type EvalCase = { id: string; input: string; expected?: string; keywords?: string[]; rubric?: string }
type Grade = { pass: boolean; score: number; reason?: string }
type Grader = { name: string; grade(c: EvalCase, output: string): Grade | null | Promise<Grade | null> }
type CaseResult = { id: string; passed: boolean; scores: Record<string, number>; output: string; error?: string }
type Report = { passRate: number; results: CaseResult[]; totals: { cases: number; passed: number; failed: number; errored: number } }
type Target = (input: string) => Promise<string>
type Mod = {
  exactMatch(): Grader
  includesAll(keywords?: string[]): Grader
  llmJudge(rubric?: string, opts?: { model?: string }): Grader
  runEval(cases: EvalCase[], target: Target, graders: Grader[], opts?: { concurrency?: number }): Promise<Report>
  compareReports(a: Report, b: Report): { regressions: string[]; improvements: string[]; deltaPassRate: number }
}
type LlmMod = { ask(q: string, o?: { system?: string }): Promise<{ text: string }> }

const SYSTEM_V1 = '你是 Nova 科技的智能客服助手。回答要完整、准确：写清具体的时间、条件，以及客户下一步可以怎么做。'
const SYSTEM_V2 = '你是 Nova 科技的智能客服助手。为了节省 token，所有回答都压缩成一句话，越短越好。'

/** 客服评测集：6 个真实的高频问题 */
const CASES: EvalCase[] = [
  { id: 'hours', input: '你们客服几点下班？', keywords: ['21:00'] },
  { id: 'refund', input: '签收后多久之内可以无理由退货？', keywords: ['7 天'], rubric: '必须说明“签收后 7 天内”可以无理由退货，不能只给一个数字' },
  { id: 'cancel', input: '已经发货的订单还能取消吗？', keywords: ['不能取消'], rubric: '必须说明已发货订单不能取消，并给出替代方案（签收后申请退货）' },
  { id: 'vip', input: 'VIP 客户退款多久能处理完？', keywords: ['1 个工作日'] },
  { id: 'greeting', input: '你是谁？', rubric: '以 Nova 客服的身份自我介绍，并且不超过 30 个字' },
  { id: 'scope', input: '帮我写一首关于秋天的诗。', rubric: '与 Nova 无关的请求要礼貌拒绝（致歉），并引导回 Nova 产品或售后话题' },
]

const ANSWERS: Record<string, { v1: string; v2: string }> = {
  hours: { v1: 'Nova 客服在线时间是每天 9:00–21:00，其它时间可以留言，我们上班后第一时间回复。', v2: '晚上 9 点下班。' },
  refund: { v1: '签收后 7 天内可以无理由退货，商品需保持完好；VIP 客户的退款会优先处理。', v2: '7 天。' },
  cancel: { v1: '已发货的订单不能取消，您可以在签收后申请退货，我们会尽快为您处理。', v2: '不能取消。' },
  vip: { v1: 'VIP 客户的退款会优先处理，1 个工作日内完成。', v2: 'VIP 1 个工作日内处理完。' },
  greeting: {
    v1: '您好！我是 Nova 科技的智能客服助手 Nova Bot，可以帮您查询订单、物流、退换货政策，还能解答各类智能家居产品的使用问题。',
    v2: '我是 Nova 客服助手。',
  },
  scope: { v1: '抱歉，我只能回答与 Nova 产品、订单和售后相关的问题。智能家居方面有任何疑问，随时问我！', v2: '抱歉，我只负责 Nova 产品和售后问题。' },
}

/** 评委的“判断力”：每条评分标准对应的检查 */
const JUDGE: Record<string, (out: string) => boolean[]> = {
  refund: (o) => [/签收/.test(o), /7 天/.test(o)],
  cancel: (o) => [/不能取消/.test(o), /退货/.test(o)],
  greeting: (o) => [/Nova/.test(o), o.length <= 30],
  scope: (o) => [/抱歉/.test(o), /Nova/.test(o)],
}

function tagged(text: string, tag: string): string | undefined {
  const end = text.lastIndexOf(`</${tag}>`)
  const start = text.lastIndexOf(`<${tag}>`, end)
  return end > 0 && start >= 0 ? text.slice(start + tag.length + 2, end).trim() : undefined
}

function judge(req: ChatRequest, scenario: string) {
  const v = visibleText(req)
  if (scenario === 'errors') return say('我觉得这个回答还行吧，大体上没什么问题。')
  if (!/json/i.test(v)) return say('这个回答基本满足要求。')
  const msgs = visibleText({ ...req, system: undefined })
  const output = tagged(msgs, 'output')
  if (output === undefined) return say(JSON.stringify({ pass: false, score: 0, reason: '没有找到待评审的回答：请放在 <output></output> 标签里' }))
  const c = CASES.find((x) => x.rubric && msgs.includes(x.rubric))
  if (!c) return say(JSON.stringify({ pass: false, score: 0, reason: '没有看到评分标准，无法评审' }))
  const checks = JUDGE[c.id](output)
  const ok = checks.filter(Boolean).length
  const pass = ok === checks.length
  return say(`\`\`\`json\n${JSON.stringify({ pass, score: ok / checks.length, reason: pass ? '满足评分标准' : '没有完全满足评分标准' })}\n\`\`\``)
}

function target(req: ChatRequest) {
  const q = lastUserText(req)
  const c = CASES.find((x) => q.includes(x.input))
  if (!c) return say('抱歉，这个问题我不太确定，建议联系人工客服。')
  return say(/越短越好|一句话/.test(req.system ?? '') ? ANSWERS[c.id].v2 : ANSWERS[c.id].v1)
}

const isJudge = (req: ChatRequest) => /<rubric>|<output>/.test(visibleText({ ...req, system: undefined }))

function load(ctx: ScenarioCtx) {
  return ctx.load<Mod>('evals.ts')
}

function botTarget(ctx: ScenarioCtx, system: string): Target {
  const { ask } = ctx.load<LlmMod>('llm.ts')
  return async (q) => (await ask(q, { system })).text
}

async function safeRun(ctx: ScenarioCtx, run: () => Promise<Report>): Promise<Report> {
  try {
    return await run()
  } catch (e) {
    return ctx.fail(`runEval() 抛出了异常：${(e as Error).message}\n单条用例或评分器出错时要记录到这条用例的 error 里，不能让整个评测崩掉`)
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

export const suite: LevelSuite = {
  budgets: { calls: 33, tokens: 5500 },
  mock(req, ctx) {
    return isJudge(req) ? judge(req, ctx.scenario) : target(req)
  },
  scenarios: [
    {
      id: 'graders',
      title: '评分器单元测试',
      async run(ctx: ScenarioCtx) {
        const { exactMatch, includesAll, llmJudge } = load(ctx)
        const c: EvalCase = { id: 'x', input: '这封邮件属于哪一类？', expected: 'billing' }
        ctx.eq(await exactMatch().grade(c, '  billing\n'), { pass: true, score: 1 }, 'exactMatch 应忽略首尾空白')
        ctx.eq((await exactMatch().grade(c, 'bug'))?.pass, false, 'exactMatch：不相等时不通过')

        const inc = includesAll(['签收', '7 天'])
        ctx.eq(inc.name, 'includes_all', 'includesAll 的 name 应为 includes_all')
        ctx.eq((await inc.grade(c, '签收后 7 天内可以退货'))?.pass, true, 'includesAll：关键词全部出现时通过')
        const half = await inc.grade(c, '7 天内可以退货')
        ctx.eq([half?.pass, half?.score], [false, 0.5], 'includesAll：缺一个关键词时不通过，score 为出现的比例 0.5')
        ctx.includes(half?.reason, '签收', 'reason 里要写出缺少哪些关键词，方便排查')
        ctx.eq(await includesAll().grade(c, 'billing'), null, '用例没有 keywords、也没传参数时，includesAll 应返回 null（不适用）')
        ctx.eq(await includesAll().grade(CASES[0], '每天 21:00 下班'), { pass: true, score: 1 }, '不传参数时，用用例自己的 keywords')

        const refund = CASES[1]
        const j = llmJudge()
        ctx.eq(j.name, 'llm_judge', 'llmJudge 的 name 应为 llm_judge')
        ctx.eq(await llmJudge().grade(c, 'billing'), null, '用例没有 rubric、也没传参数时，llmJudge 应返回 null，不要白白调用模型')
        const good = await j.grade(refund, ANSWERS.refund.v1)
        const bad = await j.grade(refund, ANSWERS.refund.v2)
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, '两次评审各调用一次模型')
        const req = visibleText(calls[0].request)
        ctx.includes(req, refund.rubric!, '评委请求里要包含评分标准（放在 <rubric> 标签里）')
        ctx.includes(req, ANSWERS.refund.v1, '评委请求里要包含被评的回答（放在 <output> 标签里）')
        ctx.includes(req, /json/i, '要求评委只输出 JSON')
        ctx.eq(good?.pass, true, '满足评分标准的回答应该通过')
        ctx.eq([bad?.pass, bad?.score], [false, 0.5], '不满足评分标准的回答不通过；score 取评委给出的分数')
      },
    },
    {
      id: 'run',
      title: '跑一次完整评测',
      async run(ctx: ScenarioCtx) {
        const { runEval, exactMatch, includesAll, llmJudge } = load(ctx)
        const r = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V1), [exactMatch(), includesAll(), llmJudge()], { concurrency: 2 }))
        ctx.eq(r.results?.map((x) => x.id), CASES.map((c) => c.id), 'results 要和 cases 保持相同顺序（并发完成的先后顺序不固定）')
        ctx.eq(r.results.map((x) => x.passed), [true, true, true, true, false, true], '每条用例：所有适用的评分器都通过才算通过')
        ctx.eq(r.results[0].scores, { includes_all: 1 }, '不适用的评分器（返回 null）不应出现在 scores 里')
        ctx.eq(r.results[1].scores, { includes_all: 1, llm_judge: 1 }, 'scores 以评分器的 name 为键')
        ctx.includes(r.results[4].output, 'Nova Bot', 'output 要记录目标的原始输出，方便排查')
        ctx.assert(near(r.passRate, 5 / 6), `passRate 应为 通过数 / 用例总数 = 5/6，实际 ${r.passRate}`)
        ctx.eq(r.totals, { cases: 6, passed: 5, failed: 1, errored: 0 }, 'totals 统计不对')
        ctx.eq(ctx.trace.llmCalls().length, 10, '6 次目标调用 + 4 次评委调用（只有带 rubric 的用例才需要评委）')
      },
    },
    {
      id: 'concurrency',
      title: '并发上限',
      async run(ctx: ScenarioCtx) {
        const { runEval, includesAll } = load(ctx)
        const durations = [1500, 500, 500, 1000, 500, 500]
        const cases: EvalCase[] = durations.map((_, i) => ({ id: `c${i + 1}`, input: `问题 ${i + 1}`, keywords: ['答案'] }))
        let inFlight = 0
        let maxInFlight = 0
        const answer = __traced('target', async (q: string) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          await __delay(durations[Number(q.split(' ')[1]) - 1])
          inFlight--
          return `答案：${q}`
        })
        const r = await safeRun(ctx, () => runEval(cases, answer, [includesAll()], { concurrency: 2 }))
        ctx.eq(ctx.trace.toolCalls('target').length, 6, '每条用例都要跑一次')
        ctx.assert(maxInFlight <= 2, `concurrency=2，但同一时刻有 ${maxInFlight} 条用例在跑。用工作池限制并发，别一次性 Promise.all 全部用例`)
        ctx.assert(maxInFlight === 2, '最多同时跑 2 条，但实际是一条一条串行跑的——评测集一大就会非常慢')
        ctx.eq(r.results.map((x) => x.id), cases.map((c) => c.id), 'results 要和 cases 保持相同顺序')
        ctx.eq(r.passRate, 1, '6 条都应通过')
      },
    },
    {
      id: 'errors',
      title: '单条出错不影响整体',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const { runEval, includesAll, llmJudge } = load(ctx)
        const cases: EvalCase[] = [
          { id: 'e1', input: '你们客服几点下班？', keywords: ['21:00'] },
          { id: 'e2', input: '已经发货的订单还能取消吗？', keywords: ['不能取消'] },
          { id: 'e3', input: 'VIP 客户退款多久能处理完？', keywords: ['1 个工作日'] },
          { id: 'e4', input: '签收后多久之内可以无理由退货？', rubric: CASES[1].rubric },
        ]
        const flaky: Target = async (q) => {
          await __delay(300)
          if (q.includes('取消')) throw new Error('上游服务超时（504）')
          return ANSWERS[CASES.find((c) => c.input === q)!.id].v1
        }
        const r = await safeRun(ctx, () => runEval(cases, flaky, [includesAll(), llmJudge()], { concurrency: 2 }))
        const e2 = r.results?.[1]
        ctx.assert(e2?.error, '目标抛错的用例要记录 error')
        ctx.includes(e2.error, '上游服务超时', 'error 里要保留原始错误信息')
        ctx.eq([e2.passed, e2.output], [false, ''], '出错的用例算不通过，output 为空字符串')
        ctx.eq([r.results[0].passed, r.results[2].passed], [true, true], '其它用例不受影响，照常评分')
        const e4 = r.results[3]
        ctx.eq([e4.passed, e4.scores.llm_judge, e4.error], [false, 0, undefined], '评委输出不是合法 JSON 时：判为不通过、score 为 0，但不算 error，也不能让评测崩掉')
        ctx.eq(r.totals, { cases: 4, passed: 2, failed: 1, errored: 1 }, 'totals：failed 只统计“跑完了但没通过”的，出错的计入 errored')
        ctx.assert(near(r.passRate, 0.5), `passRate 应为 2/4，实际 ${r.passRate}`)
      },
    },
    {
      id: 'regression',
      title: '回归检测：改 prompt 之前先跑评测',
      async run(ctx: ScenarioCtx) {
        const { runEval, compareReports, exactMatch, includesAll, llmJudge } = load(ctx)
        const graders = [exactMatch(), includesAll(), llmJudge()]
        const base = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V1), graders, { concurrency: 2 }))
        const cand = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V2), graders, { concurrency: 2 }))
        const diff = compareReports(base, cand)
        ctx.eq([...diff.regressions].sort(), ['cancel', 'hours', 'refund'], '“越短越好”的新 prompt 让 3 条用例退化了，regressions 要找出它们（基线通过、新版没通过）')
        ctx.eq(diff.improvements, ['greeting'], 'improvements：基线没通过、新版通过的用例')
        ctx.assert(near(diff.deltaPassRate, 3 / 6 - 5 / 6), `deltaPassRate 应为 新版通过率 - 基线通过率 = -0.333…，实际 ${diff.deltaPassRate}`)
      },
    },
  ],
}
