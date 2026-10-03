import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'

type Verdict = { pass: boolean; score: number; feedback: string[] }
type Round = { draft: string; verdict: Verdict }
type Result = { final: string; passed: boolean; rounds: number; history: Round[] }
type Mod = { writeWithReview(brief: string, opts: { rubric: string[]; maxRounds?: number }): Promise<Result> }

const BRIEF_VAGUE = L(
  '客户王先生的订单 NV-100001（智能空调 X1）因为中转仓爆仓延误了，帮我写一封道歉邮件。',
  "Ms. Wang's order NV-100001 (Smart AC X1) is delayed because our transit warehouse is overloaded. Please write her an apology email.",
)
const BRIEF_DETAILED = L(
  `${BRIEF_VAGUE}要求：正文写明订单号；补偿 50 元无门槛优惠券；不要承诺具体送达日期。`,
  `${BRIEF_VAGUE} Requirements: state the order number in the body; offer a ¥50 no-minimum coupon as compensation; don't promise a specific delivery date.`,
)

type Item = 'order' | 'comp' | 'date' | 'apology'

/** 评分标准：评审只会检查请求里真正出现了的条目 */
const RUBRIC: Record<Item, string> = L(
  {
    order: '正文中写明订单号（形如 NV-100001）',
    comp: '给出具体的补偿方案（例如优惠券）',
    date: '不承诺具体的送达日期',
    apology: '真诚致歉',
  },
  {
    order: 'The body states the order number (like NV-100001)',
    comp: 'Offers concrete compensation (e.g. a coupon)',
    date: 'No promise of a specific delivery date',
    apology: 'Apologizes sincerely',
  },
)
const RUBRIC_LIST = Object.values(RUBRIC)

const FEEDBACK: Record<Item, string> = L(
  {
    order: '缺少订单号：正文里要写明订单号 NV-100001，方便客户核对',
    comp: '没有补偿方案：要给出具体补偿，例如 50 元无门槛优惠券',
    date: '承诺了具体送达日期：物流不可控，删掉日期承诺，改成“有进展第一时间通知”',
    apology: '缺少致歉：开头要真诚道歉',
  },
  {
    order: 'Missing order number: include order number NV-100001 in the body so the customer can check it',
    comp: 'No compensation: offer something concrete, e.g. a ¥50 no-minimum coupon',
    date: 'Promises a specific delivery date: shipping is out of our control, so drop the date and say we\'ll notify them as soon as there\'s an update',
    apology: 'No apology: open with a sincere apology',
  },
)
const FEEDBACK_KEY: Record<Item, string> = L(
  { order: '缺少订单号', comp: '没有补偿方案', date: '承诺了具体送达日期', apology: '缺少致歉' },
  { order: 'Missing order number', comp: 'No compensation', date: 'Promises a specific delivery date', apology: 'No apology' },
)

const LINES = L(
  {
    order: '您的订单号：NV-100001。',
    comp: '为表歉意，我们已向您的账户发放 50 元无门槛优惠券作为补偿。',
    promise: '我们保证 10 月 5 日前一定送达！',
    notify: '物流一有新进展，我们会第一时间短信通知您。',
  },
  {
    order: 'Your order number: NV-100001.',
    comp: "To make up for it, we've added a ¥50 no-minimum coupon to your account.",
    promise: 'We guarantee delivery by October 5!',
    notify: "We'll text you as soon as there's any update on the delivery.",
  },
)

const CHECK: Record<Item, (d: string) => boolean> = {
  order: (d) => /NV-\d{6}/.test(d),
  comp: (d) => /补偿|优惠券|compensat|coupon/i.test(d),
  date: (d) => !/保证.*\d+\s*月\s*\d+\s*日|guarantee.*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d+/i.test(d),
  apology: (d) => /抱歉|歉意|道歉|sorry|apolog/i.test(d),
}

function compose(f: { order: boolean; comp: boolean; noPromise: boolean }): string {
  return [
    L('王先生您好：', 'Dear Ms. Wang,'),
    L(
      '非常抱歉，您购买的智能空调 X1 因中转仓爆仓未能按时送达，给您添麻烦了。',
      "We're very sorry that your Smart AC X1 didn't arrive on time because our transit warehouse was overloaded.",
    ),
    f.order && LINES.order,
    f.comp && LINES.comp,
    f.noPromise ? LINES.notify : LINES.promise,
    L('—— Nova 科技客服团队', '— The Nova Tech Support Team'),
  ]
    .filter(Boolean)
    .join('\n')
}

type State = { gen?: number; evals?: number }

/** 生成者：只会按“需求里写明的要求”和“收到的评审意见”去改 */
function writer(req: ChatRequest, scenario: string, st: State) {
  const v = visibleText(req)
  st.gen = (st.gen ?? 0) + 1
  const got = (i: Item) => v.includes(FEEDBACK_KEY[i])
  const f = {
    order: /写明订单号|state the order number/i.test(v) || got('order') || v.includes(LINES.order),
    comp: /补偿 50 元|coupon as compensation/i.test(v) || got('comp') || v.includes(LINES.comp),
    noPromise: /不要承诺|don't promise|do not promise/i.test(v) || got('date') || v.includes(LINES.notify),
  }
  if (scenario === 'max-rounds') {
    f.noPromise = false // 这个生成者很固执：怎么说都要承诺日期
    if (st.gen >= 3) f.comp = false // 第三稿还把补偿改丢了
  }
  return say(compose(f))
}

function evaluator(req: ChatRequest, scenario: string, st: State) {
  const v = visibleText(req)
  st.evals = (st.evals ?? 0) + 1
  if (scenario === 'bad-json' && st.evals === 1)
    return say(
      L(
        '整体写得不错，语气很真诚，可以 pass。不过个人建议再补充一下订单信息。',
        "Nicely written overall and the tone is sincere, I'd give it a pass. Personally I'd add a bit more about the order, though.",
      ),
    )
  if (!/json/i.test(v)) return say(L('这封邮件整体不错，但还有改进空间。', "This email is decent overall, but there's room for improvement."))
  // 只在消息里找草稿（system 里可能也提到了 <draft> 标签），取最后一份
  const msgs = visibleText({ ...req, system: undefined })
  const end = msgs.lastIndexOf('</draft>')
  const start = msgs.lastIndexOf('<draft>', end)
  const draft = end > 0 && start >= 0 ? msgs.slice(start + 7, end) : undefined
  if (!draft)
    return say(
      JSON.stringify({
        pass: false,
        score: 0,
        feedback: [L('没有找到要评审的草稿：请把草稿放在 <draft></draft> 标签里', 'No draft to review: put the draft inside <draft></draft> tags')],
      }),
    )
  const items = (Object.keys(RUBRIC) as Item[]).filter((i) => v.includes(RUBRIC[i]))
  if (!items.length) return say(JSON.stringify({ pass: false, score: 0, feedback: [L('没有看到评分标准，无法评审', "No rubric provided, can't review")] }))
  const failed = items.filter((i) => !CHECK[i](draft))
  const score = Math.round((10 * (items.length - failed.length)) / items.length)
  return say(`\`\`\`json\n${JSON.stringify({ pass: failed.length === 0, score, feedback: failed.map((i) => FEEDBACK[i]) }, null, 2)}\n\`\`\``)
}

async function run(ctx: ScenarioCtx, brief: string, maxRounds?: number): Promise<Result> {
  const { writeWithReview } = ctx.load<Mod>('refine.ts')
  try {
    return await writeWithReview(brief, { rubric: RUBRIC_LIST, maxRounds })
  } catch (e) {
    return ctx.fail(L(`writeWithReview() 抛出了异常：${(e as Error).message}`, `writeWithReview() threw: ${(e as Error).message}`))
  }
}

const isEval = (req: ChatRequest) => /score/i.test(visibleText(req)) && /feedback/i.test(visibleText(req))

export const suite: LevelSuite = {
  budgets: L({ calls: 17, tokens: 6300 }, { calls: 17, tokens: 5100 }),
  mock(req, ctx) {
    const st = ctx.state as State
    return isEval(req) ? evaluator(req, ctx.scenario, st) : writer(req, ctx.scenario, st)
  },
  scenarios: [
    {
      id: 'revise',
      title: L('评审 → 按意见修改 → 通过', 'Evaluate → revise from feedback → pass'),
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        const calls = ctx.trace.llmCalls()
        ctx.assert(
          calls.length >= 2 && isEval(calls[1].request),
          L(
            '写完第一稿后，应该调用评审者（带评分标准，要求输出包含 pass / score / feedback 的 JSON）',
            'After the first draft, call the evaluator (with the rubric, asking for JSON with pass / score / feedback)',
          ),
        )
        const [gen, ev] = [calls[0].request, calls[1].request]
        ctx.assert(
          ev.system && ev.system !== gen.system,
          L('评审者要有自己独立的 system 提示词（独立角色），不要和生成者共用', "The evaluator needs its own system prompt (a separate role), not the generator's"),
        )
        for (const item of RUBRIC_LIST) ctx.includes(visibleText(ev), item, L('评审请求里要逐条列出评分标准', 'The evaluation request should list every rubric item'))
        ctx.includes(visibleText(ev), '<draft>', L('草稿要放在 <draft>...</draft> 标签里交给评审', 'Give the draft to the evaluator inside <draft>...</draft> tags'))

        ctx.eq(r.history?.length, 2, L('第一稿没通过、第二稿通过：history 里应有 2 轮', 'The first draft fails and the second passes: history should have 2 rounds'))
        ctx.eq(r.history[0].verdict?.pass, false, L('第一轮评审结果应为不通过', 'The first round should not pass'))
        ctx.eq(
          r.history[0].verdict.feedback.length,
          3,
          L('第一轮应有 3 条评审意见（订单号、补偿、日期承诺）', 'The first round should have 3 pieces of feedback (order number, compensation, date promise)'),
        )
        ctx.eq([r.rounds, r.passed], [2, true], L('应在第 2 轮通过并停止', 'Should pass in round 2 and stop'))
        ctx.eq(calls.length, 4, L('两轮 = 生成 + 评审 + 修改 + 评审，共 4 次调用', 'Two rounds = generate + evaluate + revise + evaluate, 4 calls in total'))

        const revise = visibleText(calls[2].request)
        ctx.includes(revise, r.history[0].draft, L('修改请求里要带上上一版草稿，生成者才知道改哪里', 'Include the previous draft in the revision request so the generator knows what to change'))
        for (const fb of r.history[0].verdict.feedback)
          ctx.includes(revise, fb, L('修改请求里要原样带上每一条评审意见', 'Include every piece of feedback verbatim in the revision request'))
        ctx.includes(r.final, 'NV-100001', L('最终稿应写明订单号', 'The final draft should state the order number'))
        ctx.includes(r.final, L('优惠券', 'coupon'), L('最终稿应包含补偿方案', 'The final draft should include compensation'))
        ctx.assert(!r.final.includes(L('保证 10 月 5 日', 'guarantee delivery by October 5')), L('最终稿不应承诺送达日期', 'The final draft should not promise a delivery date'))
      },
    },
    {
      id: 'first-pass',
      title: L('一稿通过：立即停止', 'Pass on the first draft: stop right away'),
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_DETAILED, 3)
        ctx.eq([r.rounds, r.passed], [1, true], L('第一稿就满足全部标准时，应该立即停止', 'When the first draft meets every rubric item, stop right away'))
        ctx.eq(
          ctx.trace.llmCalls().length,
          2,
          L('一稿通过只需要 生成 + 评审 两次调用，不要多余的轮次', 'Passing on the first draft takes just 2 calls, generate + evaluate, with no extra rounds'),
        )
        ctx.eq(r.final, r.history[0]?.draft, L('final 应是通过评审的那一稿', 'final should be the draft that passed'))
      },
    },
    {
      id: 'max-rounds',
      title: L('轮数上限 + 保留最好的一版', 'Round limit + keep the best draft'),
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        ctx.eq(
          ctx.trace.llmCalls().length,
          6,
          L(
            'maxRounds=3：最多 3 轮（每轮 生成 + 评审），一共 6 次调用，不能无限改下去',
            "maxRounds=3: at most 3 rounds (generate + evaluate each), 6 calls in total. Don't revise forever",
          ),
        )
        ctx.eq([r.rounds, r.passed], [3, false], L('3 轮都没通过：rounds 为 3，passed 为 false', 'None of the 3 rounds passed: rounds is 3, passed is false'))
        ctx.eq(r.history.map((h) => h.verdict.score), [3, 8, 5], L('history 要记录每一轮的草稿和评审结果', "history should record each round's draft and verdict"))
        ctx.eq(
          r.final,
          r.history[1].draft,
          L(
            '一直没通过时，要返回得分最高的那一版（第 2 轮，8 分），而不是最后一版——改着改着可能改坏',
            'When nothing passes, return the highest-scoring draft (round 2, score 8), not the last one: revisions can make things worse',
          ),
        )
      },
    },
    {
      id: 'bad-json',
      title: L('评审输出格式错误', 'Malformed evaluator output'),
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        ctx.eq(
          r.history?.[0]?.verdict?.pass,
          false,
          L(
            '评审第一次输出了一段文字（里面还有“pass”）——不能把解析不了的输出当成通过；应该把错误反馈给评审者重试',
            'The evaluator\'s first output was prose (that even contains "pass"). Output that can\'t be parsed must not count as a pass; feed the error back to the evaluator and retry',
          ),
        )
        ctx.eq([r.rounds, r.passed], [2, true], L('评审重试拿到合法 JSON 后，流程照常进行：第 2 轮通过', 'Once the evaluator retry returns valid JSON, the flow continues as usual: pass in round 2'))
        ctx.eq(
          ctx.trace.llmCalls().length,
          5,
          L('生成 + 评审(格式错) + 评审重试 + 修改 + 评审 = 5 次调用', 'generate + evaluate (malformed) + evaluate retry + revise + evaluate = 5 calls'),
        )
        ctx.includes(r.final, 'NV-100001', L('最终稿应写明订单号', 'The final draft should state the order number'))
      },
    },
  ],
}
