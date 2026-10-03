import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { say, visibleText } from '../../../engine/llm/mock-kit'
import type { ChatRequest } from '../../../engine/llm/types'

type Verdict = { pass: boolean; score: number; feedback: string[] }
type Round = { draft: string; verdict: Verdict }
type Result = { final: string; passed: boolean; rounds: number; history: Round[] }
type Mod = { writeWithReview(brief: string, opts: { rubric: string[]; maxRounds?: number }): Promise<Result> }

const BRIEF_VAGUE = '客户王先生的订单 NV-100001（智能空调 X1）因为中转仓爆仓延误了，帮我写一封道歉邮件。'
const BRIEF_DETAILED = `${BRIEF_VAGUE}要求：正文写明订单号；补偿 50 元无门槛优惠券；不要承诺具体送达日期。`

type Item = 'order' | 'comp' | 'date' | 'apology'

/** 评分标准：评审只会检查请求里真正出现了的条目 */
const RUBRIC: Record<Item, string> = {
  order: '正文中写明订单号（形如 NV-100001）',
  comp: '给出具体的补偿方案（例如优惠券）',
  date: '不承诺具体的送达日期',
  apology: '真诚致歉',
}
const RUBRIC_LIST = Object.values(RUBRIC)

const FEEDBACK: Record<Item, string> = {
  order: '缺少订单号：正文里要写明订单号 NV-100001，方便客户核对',
  comp: '没有补偿方案：要给出具体补偿，例如 50 元无门槛优惠券',
  date: '承诺了具体送达日期：物流不可控，删掉日期承诺，改成“有进展第一时间通知”',
  apology: '缺少致歉：开头要真诚道歉',
}
const FEEDBACK_KEY: Record<Item, string> = { order: '缺少订单号', comp: '没有补偿方案', date: '承诺了具体送达日期', apology: '缺少致歉' }

const LINES = {
  order: '您的订单号：NV-100001。',
  comp: '为表歉意，我们已向您的账户发放 50 元无门槛优惠券作为补偿。',
  promise: '我们保证 10 月 5 日前一定送达！',
  notify: '物流一有新进展，我们会第一时间短信通知您。',
}

const CHECK: Record<Item, (d: string) => boolean> = {
  order: (d) => /NV-\d{6}/.test(d),
  comp: (d) => /补偿|优惠券/.test(d),
  date: (d) => !/保证.*\d+\s*月\s*\d+\s*日/.test(d),
  apology: (d) => /抱歉|歉意|道歉/.test(d),
}

function compose(f: { order: boolean; comp: boolean; noPromise: boolean }): string {
  return [
    '王先生您好：',
    '非常抱歉，您购买的智能空调 X1 因中转仓爆仓未能按时送达，给您添麻烦了。',
    f.order && LINES.order,
    f.comp && LINES.comp,
    f.noPromise ? LINES.notify : LINES.promise,
    '—— Nova 科技客服团队',
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
    order: /写明订单号/.test(v) || got('order') || v.includes(LINES.order),
    comp: /补偿 50 元/.test(v) || got('comp') || v.includes(LINES.comp),
    noPromise: /不要承诺/.test(v) || got('date') || v.includes(LINES.notify),
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
  if (scenario === 'bad-json' && st.evals === 1) return say('整体写得不错，语气很真诚，可以 pass。不过个人建议再补充一下订单信息。')
  if (!/json/i.test(v)) return say('这封邮件整体不错，但还有改进空间。')
  // 只在消息里找草稿（system 里可能也提到了 <draft> 标签），取最后一份
  const msgs = visibleText({ ...req, system: undefined })
  const end = msgs.lastIndexOf('</draft>')
  const start = msgs.lastIndexOf('<draft>', end)
  const draft = end > 0 && start >= 0 ? msgs.slice(start + 7, end) : undefined
  if (!draft) return say(JSON.stringify({ pass: false, score: 0, feedback: ['没有找到要评审的草稿：请把草稿放在 <draft></draft> 标签里'] }))
  const items = (Object.keys(RUBRIC) as Item[]).filter((i) => v.includes(RUBRIC[i]))
  if (!items.length) return say(JSON.stringify({ pass: false, score: 0, feedback: ['没有看到评分标准，无法评审'] }))
  const failed = items.filter((i) => !CHECK[i](draft))
  const score = Math.round((10 * (items.length - failed.length)) / items.length)
  return say(`\`\`\`json\n${JSON.stringify({ pass: failed.length === 0, score, feedback: failed.map((i) => FEEDBACK[i]) }, null, 2)}\n\`\`\``)
}

async function run(ctx: ScenarioCtx, brief: string, maxRounds?: number): Promise<Result> {
  const { writeWithReview } = ctx.load<Mod>('refine.ts')
  try {
    return await writeWithReview(brief, { rubric: RUBRIC_LIST, maxRounds })
  } catch (e) {
    return ctx.fail(`writeWithReview() 抛出了异常：${(e as Error).message}`)
  }
}

const isEval = (req: ChatRequest) => /score/i.test(visibleText(req)) && /feedback/i.test(visibleText(req))

export const suite: LevelSuite = {
  budgets: { calls: 17, tokens: 6300 },
  mock(req, ctx) {
    const st = ctx.state as State
    return isEval(req) ? evaluator(req, ctx.scenario, st) : writer(req, ctx.scenario, st)
  },
  scenarios: [
    {
      id: 'revise',
      title: '评审 → 按意见修改 → 通过',
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        const calls = ctx.trace.llmCalls()
        ctx.assert(calls.length >= 2 && isEval(calls[1].request), '写完第一稿后，应该调用评审者（带评分标准，要求输出包含 pass / score / feedback 的 JSON）')
        const [gen, ev] = [calls[0].request, calls[1].request]
        ctx.assert(ev.system && ev.system !== gen.system, '评审者要有自己独立的 system 提示词（独立角色），不要和生成者共用')
        for (const item of RUBRIC_LIST) ctx.includes(visibleText(ev), item, '评审请求里要逐条列出评分标准')
        ctx.includes(visibleText(ev), '<draft>', '草稿要放在 <draft>...</draft> 标签里交给评审')

        ctx.eq(r.history?.length, 2, '第一稿没通过、第二稿通过：history 里应有 2 轮')
        ctx.eq(r.history[0].verdict?.pass, false, '第一轮评审结果应为不通过')
        ctx.eq(r.history[0].verdict.feedback.length, 3, '第一轮应有 3 条评审意见（订单号、补偿、日期承诺）')
        ctx.eq([r.rounds, r.passed], [2, true], '应在第 2 轮通过并停止')
        ctx.eq(calls.length, 4, '两轮 = 生成 + 评审 + 修改 + 评审，共 4 次调用')

        const revise = visibleText(calls[2].request)
        ctx.includes(revise, r.history[0].draft, '修改请求里要带上上一版草稿，生成者才知道改哪里')
        for (const fb of r.history[0].verdict.feedback) ctx.includes(revise, fb, '修改请求里要原样带上每一条评审意见')
        ctx.includes(r.final, 'NV-100001', '最终稿应写明订单号')
        ctx.includes(r.final, '优惠券', '最终稿应包含补偿方案')
        ctx.assert(!r.final.includes('保证 10 月 5 日'), '最终稿不应承诺送达日期')
      },
    },
    {
      id: 'first-pass',
      title: '一稿通过：立即停止',
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_DETAILED, 3)
        ctx.eq([r.rounds, r.passed], [1, true], '第一稿就满足全部标准时，应该立即停止')
        ctx.eq(ctx.trace.llmCalls().length, 2, '一稿通过只需要 生成 + 评审 两次调用，不要多余的轮次')
        ctx.eq(r.final, r.history[0]?.draft, 'final 应是通过评审的那一稿')
      },
    },
    {
      id: 'max-rounds',
      title: '轮数上限 + 保留最好的一版',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        ctx.eq(ctx.trace.llmCalls().length, 6, 'maxRounds=3：最多 3 轮（每轮 生成 + 评审），一共 6 次调用，不能无限改下去')
        ctx.eq([r.rounds, r.passed], [3, false], '3 轮都没通过：rounds 为 3，passed 为 false')
        ctx.eq(r.history.map((h) => h.verdict.score), [3, 8, 5], 'history 要记录每一轮的草稿和评审结果')
        ctx.eq(r.final, r.history[1].draft, '一直没通过时，要返回得分最高的那一版（第 2 轮，8 分），而不是最后一版——改着改着可能改坏')
      },
    },
    {
      id: 'bad-json',
      title: '评审输出格式错误',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const r = await run(ctx, BRIEF_VAGUE, 3)
        ctx.eq(r.history?.[0]?.verdict?.pass, false, '评审第一次输出了一段文字（里面还有“pass”）——不能把解析不了的输出当成通过；应该把错误反馈给评审者重试')
        ctx.eq([r.rounds, r.passed], [2, true], '评审重试拿到合法 JSON 后，流程照常进行：第 2 轮通过')
        ctx.eq(ctx.trace.llmCalls().length, 5, '生成 + 评审(格式错) + 评审重试 + 修改 + 评审 = 5 次调用')
        ctx.includes(r.final, 'NV-100001', '最终稿应写明订单号')
      },
    },
  ],
}
