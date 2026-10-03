import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { lastUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'
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

const SYSTEM_V1 = L(
  '你是 Nova 科技的智能客服助手。回答要完整、准确：写清具体的时间、条件，以及客户下一步可以怎么做。',
  "You are Nova Tech's support assistant. Give complete, accurate answers: state the exact times and conditions, and what the customer can do next.",
)
const SYSTEM_V2 = L(
  '你是 Nova 科技的智能客服助手。为了节省 token，所有回答都压缩成一句话，越短越好。',
  "You are Nova Tech's support assistant. To save tokens, squeeze every answer into one sentence. The shorter the better.",
)

/** 客服评测集：6 个真实的高频问题 */
const CASES: EvalCase[] = L(
  [
    { id: 'hours', input: '你们客服几点下班？', keywords: ['21:00'] },
    { id: 'refund', input: '签收后多久之内可以无理由退货？', keywords: ['7 天'], rubric: '必须说明“签收后 7 天内”可以无理由退货，不能只给一个数字' },
    { id: 'cancel', input: '已经发货的订单还能取消吗？', keywords: ['不能取消'], rubric: '必须说明已发货订单不能取消，并给出替代方案（签收后申请退货）' },
    { id: 'vip', input: 'VIP 客户退款多久能处理完？', keywords: ['1 个工作日'] },
    { id: 'greeting', input: '你是谁？', rubric: '以 Nova 客服的身份自我介绍，并且不超过 30 个字' },
    { id: 'scope', input: '帮我写一首关于秋天的诗。', rubric: '与 Nova 无关的请求要礼貌拒绝（致歉），并引导回 Nova 产品或售后话题' },
  ],
  [
    { id: 'hours', input: 'What time does your support close?', keywords: ['21:00'] },
    { id: 'refund', input: 'How long after delivery can I return something for any reason?', keywords: ['7 days'], rubric: 'Must say items can be returned for any reason "within 7 days of delivery" — not just give a bare number' },
    { id: 'cancel', input: "Can I still cancel an order that's already shipped?", keywords: ['cannot be cancelled'], rubric: 'Must say shipped orders cannot be cancelled, and offer an alternative (request a return after delivery)' },
    { id: 'vip', input: 'How long do VIP refunds take?', keywords: ['1 business day'] },
    { id: 'greeting', input: 'Who are you?', rubric: 'Introduces itself as Nova support, in 60 characters or fewer' },
    { id: 'scope', input: 'Write me a poem about autumn.', rubric: 'Politely declines requests unrelated to Nova (apologizes) and steers back to Nova products or after-sales topics' },
  ],
)

const ANSWERS: Record<string, { v1: string; v2: string }> = L(
  {
    hours: { v1: 'Nova 客服在线时间是每天 9:00–21:00，其它时间可以留言，我们上班后第一时间回复。', v2: '晚上 9 点下班。' },
    refund: { v1: '签收后 7 天内可以无理由退货，商品需保持完好；VIP 客户的退款会优先处理。', v2: '7 天。' },
    cancel: { v1: '已发货的订单不能取消，您可以在签收后申请退货，我们会尽快为您处理。', v2: '不能取消。' },
    vip: { v1: 'VIP 客户的退款会优先处理，1 个工作日内完成。', v2: 'VIP 1 个工作日内处理完。' },
    greeting: {
      v1: '您好！我是 Nova 科技的智能客服助手 Nova Bot，可以帮您查询订单、物流、退换货政策，还能解答各类智能家居产品的使用问题。',
      v2: '我是 Nova 客服助手。',
    },
    scope: { v1: '抱歉，我只能回答与 Nova 产品、订单和售后相关的问题。智能家居方面有任何疑问，随时问我！', v2: '抱歉，我只负责 Nova 产品和售后问题。' },
  },
  {
    hours: { v1: "Nova support is online 9:00–21:00 every day. Outside those hours, leave a message and we'll reply first thing.", v2: 'We close at 9 pm.' },
    refund: { v1: 'You can return items for any reason within 7 days of delivery, as long as they are in good condition. VIP refunds are prioritized.', v2: '7 days.' },
    cancel: { v1: "Shipped orders cannot be cancelled, but you can request a return once it's delivered and we'll process it right away.", v2: 'It cannot be cancelled.' },
    vip: { v1: 'VIP refunds are prioritized and completed within 1 business day.', v2: 'VIP: within 1 business day.' },
    greeting: {
      v1: "Hi! I'm Nova Bot, Nova Tech's support assistant. I can look up orders and shipping, explain our return policy, and answer questions about any of our smart home products.",
      v2: "I'm the Nova support assistant.",
    },
    scope: { v1: "Sorry, I can only help with questions about Nova products, orders and after-sales service. If you have any smart home questions, just ask!", v2: 'Sorry, I only handle Nova products and after-sales questions.' },
  },
)

/** 评委的“判断力”：每条评分标准对应的检查 */
const JUDGE: Record<string, (out: string) => boolean[]> = L(
  {
    refund: (o) => [/签收/.test(o), /7 天/.test(o)],
    cancel: (o) => [/不能取消/.test(o), /退货/.test(o)],
    greeting: (o) => [/Nova/.test(o), o.length <= 30],
    scope: (o) => [/抱歉/.test(o), /Nova/.test(o)],
  },
  {
    refund: (o) => [/deliver/i.test(o), /7 days/.test(o)],
    cancel: (o) => [/cannot be cancell?ed/i.test(o), /return/i.test(o)],
    greeting: (o) => [/Nova/.test(o), o.length <= 60],
    scope: (o) => [/sorry/i.test(o), /Nova/.test(o)],
  },
)

function tagged(text: string, tag: string): string | undefined {
  const end = text.lastIndexOf(`</${tag}>`)
  const start = text.lastIndexOf(`<${tag}>`, end)
  return end > 0 && start >= 0 ? text.slice(start + tag.length + 2, end).trim() : undefined
}

function judge(req: ChatRequest, scenario: string) {
  const v = visibleText(req)
  if (scenario === 'errors') return say(L('我觉得这个回答还行吧，大体上没什么问题。', 'I think this answer is fine overall, nothing major wrong with it.'))
  if (!/json/i.test(v)) return say(L('这个回答基本满足要求。', 'This answer mostly meets the requirements.'))
  const msgs = visibleText({ ...req, system: undefined })
  const output = tagged(msgs, 'output')
  if (output === undefined) return say(JSON.stringify({ pass: false, score: 0, reason: L('没有找到待评审的回答：请放在 <output></output> 标签里', 'No answer to grade: put it inside <output></output> tags') }))
  const c = CASES.find((x) => x.rubric && msgs.includes(x.rubric))
  if (!c) return say(JSON.stringify({ pass: false, score: 0, reason: L('没有看到评分标准，无法评审', "No rubric found, so I can't grade this") }))
  const checks = JUDGE[c.id](output)
  const ok = checks.filter(Boolean).length
  const pass = ok === checks.length
  return say(`\`\`\`json\n${JSON.stringify({ pass, score: ok / checks.length, reason: pass ? L('满足评分标准', 'Meets the rubric') : L('没有完全满足评分标准', "Doesn't fully meet the rubric") })}\n\`\`\``)
}

function target(req: ChatRequest) {
  const q = lastUserText(req)
  const c = CASES.find((x) => q.includes(x.input))
  if (!c) return say(L('抱歉，这个问题我不太确定，建议联系人工客服。', "Sorry, I'm not sure about that one. Please contact a human agent."))
  return say(/越短越好|一句话|shorter the better|one sentence/i.test(req.system ?? '') ? ANSWERS[c.id].v2 : ANSWERS[c.id].v1)
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
    return ctx.fail(
      L(
        `runEval() 抛出了异常：${(e as Error).message}\n单条用例或评分器出错时要记录到这条用例的 error 里，不能让整个评测崩掉`,
        `runEval() threw: ${(e as Error).message}\nWhen a single case or grader fails, record it in that case's error field instead of crashing the whole eval`,
      ),
    )
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

export const suite: LevelSuite = {
  budgets: L({ calls: 33, tokens: 5500 }, { calls: 33, tokens: 4700 }),
  mock(req, ctx) {
    return isJudge(req) ? judge(req, ctx.scenario) : target(req)
  },
  scenarios: [
    {
      id: 'graders',
      title: L('评分器单元测试', 'Grader unit tests'),
      async run(ctx: ScenarioCtx) {
        const { exactMatch, includesAll, llmJudge } = load(ctx)
        const c: EvalCase = { id: 'x', input: L('这封邮件属于哪一类？', 'Which category is this email?'), expected: 'billing' }
        ctx.eq(await exactMatch().grade(c, '  billing\n'), { pass: true, score: 1 }, L('exactMatch 应忽略首尾空白', 'exactMatch should ignore leading/trailing whitespace'))
        ctx.eq((await exactMatch().grade(c, 'bug'))?.pass, false, L('exactMatch：不相等时不通过', "exactMatch: should fail when the strings don't match"))

        const inc = includesAll(L(['签收', '7 天'], ['delivery', '7 days']))
        ctx.eq(inc.name, 'includes_all', L('includesAll 的 name 应为 includes_all', "includesAll's name should be includes_all"))
        ctx.eq((await inc.grade(c, L('签收后 7 天内可以退货', 'Returns accepted within 7 days of delivery')))?.pass, true, L('includesAll：关键词全部出现时通过', 'includesAll: should pass when every keyword appears'))
        const half = await inc.grade(c, L('7 天内可以退货', 'Returns accepted within 7 days'))
        ctx.eq([half?.pass, half?.score], [false, 0.5], L('includesAll：缺一个关键词时不通过，score 为出现的比例 0.5', 'includesAll: with one keyword missing it should fail, and score is the fraction present (0.5)'))
        ctx.includes(half?.reason, L('签收', 'delivery'), L('reason 里要写出缺少哪些关键词，方便排查', 'reason should list the missing keywords so failures are easy to debug'))
        ctx.eq(await includesAll().grade(c, 'billing'), null, L('用例没有 keywords、也没传参数时，includesAll 应返回 null（不适用）', 'When the case has no keywords and none were passed in, includesAll should return null (not applicable)'))
        ctx.eq(await includesAll().grade(CASES[0], L('每天 21:00 下班', 'We close at 21:00 every day')), { pass: true, score: 1 }, L('不传参数时，用用例自己的 keywords', "With no argument, use the case's own keywords"))

        const refund = CASES[1]
        const j = llmJudge()
        ctx.eq(j.name, 'llm_judge', L('llmJudge 的 name 应为 llm_judge', "llmJudge's name should be llm_judge"))
        ctx.eq(await llmJudge().grade(c, 'billing'), null, L('用例没有 rubric、也没传参数时，llmJudge 应返回 null，不要白白调用模型', "When the case has no rubric and none was passed in, llmJudge should return null — don't waste a model call"))
        const good = await j.grade(refund, ANSWERS.refund.v1)
        const bad = await j.grade(refund, ANSWERS.refund.v2)
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, L('两次评审各调用一次模型', 'Each of the two gradings should call the model once'))
        const req = visibleText(calls[0].request)
        ctx.includes(req, refund.rubric!, L('评委请求里要包含评分标准（放在 <rubric> 标签里）', 'The judge request must include the rubric (inside <rubric> tags)'))
        ctx.includes(req, ANSWERS.refund.v1, L('评委请求里要包含被评的回答（放在 <output> 标签里）', 'The judge request must include the answer being graded (inside <output> tags)'))
        ctx.includes(req, /json/i, L('要求评委只输出 JSON', 'Tell the judge to output JSON only'))
        ctx.eq(good?.pass, true, L('满足评分标准的回答应该通过', 'An answer that meets the rubric should pass'))
        ctx.eq([bad?.pass, bad?.score], [false, 0.5], L('不满足评分标准的回答不通过；score 取评委给出的分数', "An answer that misses the rubric should fail; score is the judge's score"))
      },
    },
    {
      id: 'run',
      title: L('跑一次完整评测', 'A full eval run'),
      async run(ctx: ScenarioCtx) {
        const { runEval, exactMatch, includesAll, llmJudge } = load(ctx)
        const r = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V1), [exactMatch(), includesAll(), llmJudge()], { concurrency: 2 }))
        ctx.eq(r.results?.map((x) => x.id), CASES.map((c) => c.id), L('results 要和 cases 保持相同顺序（并发完成的先后顺序不固定）', 'results must be in the same order as cases (concurrent cases finish in any order)'))
        ctx.eq(r.results.map((x) => x.passed), [true, true, true, true, false, true], L('每条用例：所有适用的评分器都通过才算通过', 'A case passes only if every applicable grader passes'))
        ctx.eq(r.results[0].scores, { includes_all: 1 }, L('不适用的评分器（返回 null）不应出现在 scores 里', "Graders that don't apply (return null) shouldn't appear in scores"))
        ctx.eq(r.results[1].scores, { includes_all: 1, llm_judge: 1 }, L('scores 以评分器的 name 为键', "scores should be keyed by the grader's name"))
        ctx.includes(r.results[4].output, 'Nova Bot', L('output 要记录目标的原始输出，方便排查', "output should hold the target's raw output for debugging"))
        ctx.assert(near(r.passRate, 5 / 6), L(`passRate 应为 通过数 / 用例总数 = 5/6，实际 ${r.passRate}`, `passRate should be passed / total cases = 5/6, got ${r.passRate}`))
        ctx.eq(r.totals, { cases: 6, passed: 5, failed: 1, errored: 0 }, L('totals 统计不对', 'totals are wrong'))
        ctx.eq(ctx.trace.llmCalls().length, 10, L('6 次目标调用 + 4 次评委调用（只有带 rubric 的用例才需要评委）', '6 target calls + 4 judge calls (only cases with a rubric need the judge)'))
      },
    },
    {
      id: 'concurrency',
      title: L('并发上限', 'Concurrency limit'),
      async run(ctx: ScenarioCtx) {
        const { runEval, includesAll } = load(ctx)
        const durations = [1500, 500, 500, 1000, 500, 500]
        const ANSWER = L('答案', 'Answer')
        const cases: EvalCase[] = durations.map((_, i) => ({ id: `c${i + 1}`, input: `${L('问题', 'Question')} ${i + 1}`, keywords: [ANSWER] }))
        let inFlight = 0
        let maxInFlight = 0
        const answer = __traced('target', async (q: string) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          await __delay(durations[Number(q.split(' ')[1]) - 1])
          inFlight--
          return `${ANSWER}${L('：', ': ')}${q}`
        })
        const r = await safeRun(ctx, () => runEval(cases, answer, [includesAll()], { concurrency: 2 }))
        ctx.eq(ctx.trace.toolCalls('target').length, 6, L('每条用例都要跑一次', 'Every case should run once'))
        ctx.assert(maxInFlight <= 2, L(`concurrency=2，但同一时刻有 ${maxInFlight} 条用例在跑。用工作池限制并发，别一次性 Promise.all 全部用例`, `concurrency=2, but ${maxInFlight} cases were running at the same time. Use a worker pool to limit concurrency instead of Promise.all over every case`))
        ctx.assert(maxInFlight === 2, L('最多同时跑 2 条，但实际是一条一条串行跑的——评测集一大就会非常慢', 'Up to 2 cases may run at once, but they ran one at a time — that gets very slow once the eval set grows'))
        ctx.eq(r.results.map((x) => x.id), cases.map((c) => c.id), L('results 要和 cases 保持相同顺序', 'results must be in the same order as cases'))
        ctx.eq(r.passRate, 1, L('6 条都应通过', 'All 6 cases should pass'))
      },
    },
    {
      id: 'errors',
      title: L('单条出错不影响整体', "One failure doesn't sink the run"),
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const { runEval, includesAll, llmJudge } = load(ctx)
        const cases: EvalCase[] = [
          { id: 'e1', input: CASES[0].input, keywords: CASES[0].keywords },
          { id: 'e2', input: CASES[2].input, keywords: CASES[2].keywords },
          { id: 'e3', input: CASES[3].input, keywords: CASES[3].keywords },
          { id: 'e4', input: CASES[1].input, rubric: CASES[1].rubric },
        ]
        const flaky: Target = async (q) => {
          await __delay(300)
          if (q.includes(L('取消', 'cancel'))) throw new Error(L('上游服务超时（504）', 'Upstream service timed out (504)'))
          return ANSWERS[CASES.find((c) => c.input === q)!.id].v1
        }
        const r = await safeRun(ctx, () => runEval(cases, flaky, [includesAll(), llmJudge()], { concurrency: 2 }))
        const e2 = r.results?.[1]
        ctx.assert(e2?.error, L('目标抛错的用例要记录 error', 'A case whose target threw should record an error'))
        ctx.includes(e2.error, L('上游服务超时', 'Upstream service timed out'), L('error 里要保留原始错误信息', 'error should keep the original error message'))
        ctx.eq([e2.passed, e2.output], [false, ''], L('出错的用例算不通过，output 为空字符串', 'A case that errored counts as failed, with output set to an empty string'))
        ctx.eq([r.results[0].passed, r.results[2].passed], [true, true], L('其它用例不受影响，照常评分', 'Other cases are unaffected and graded as usual'))
        const e4 = r.results[3]
        ctx.eq([e4.passed, e4.scores.llm_judge, e4.error], [false, 0, undefined], L('评委输出不是合法 JSON 时：判为不通过、score 为 0，但不算 error，也不能让评测崩掉', "When the judge's output isn't valid JSON: fail with score 0, but it's not an error, and it mustn't crash the eval"))
        ctx.eq(r.totals, { cases: 4, passed: 2, failed: 1, errored: 1 }, L('totals：failed 只统计“跑完了但没通过”的，出错的计入 errored', 'totals: failed only counts cases that ran but didn\'t pass; cases that errored go in errored'))
        ctx.assert(near(r.passRate, 0.5), L(`passRate 应为 2/4，实际 ${r.passRate}`, `passRate should be 2/4, got ${r.passRate}`))
      },
    },
    {
      id: 'regression',
      title: L('回归检测：改 prompt 之前先跑评测', 'Regression detection: run the evals before changing the prompt'),
      async run(ctx: ScenarioCtx) {
        const { runEval, compareReports, exactMatch, includesAll, llmJudge } = load(ctx)
        const graders = [exactMatch(), includesAll(), llmJudge()]
        const base = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V1), graders, { concurrency: 2 }))
        const cand = await safeRun(ctx, () => runEval(CASES, botTarget(ctx, SYSTEM_V2), graders, { concurrency: 2 }))
        const diff = compareReports(base, cand)
        ctx.eq([...diff.regressions].sort(), ['cancel', 'hours', 'refund'], L('“越短越好”的新 prompt 让 3 条用例退化了，regressions 要找出它们（基线通过、新版没通过）', 'The new "shorter the better" prompt broke 3 cases; regressions should list them (passed in the baseline, failed in the candidate)'))
        ctx.eq(diff.improvements, ['greeting'], L('improvements：基线没通过、新版通过的用例', 'improvements: cases that failed in the baseline and pass in the candidate'))
        ctx.assert(near(diff.deltaPassRate, 3 / 6 - 5 / 6), L(`deltaPassRate 应为 新版通过率 - 基线通过率 = -0.333…，实际 ${diff.deltaPassRate}`, `deltaPassRate should be candidate pass rate - baseline pass rate = -0.333…, got ${diff.deltaPassRate}`))
      },
    },
  ],
}
