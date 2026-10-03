import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { allToolResults, callTools, firstUserText, say, visibleText } from '../../../engine/llm/mock-kit'
import { estimateTokens } from '../../../engine/llm/tokens'
import { LLMError, type ChatRequest } from '../../../engine/llm/types'
import { createMarket, DIMENSIONS, FACTS, marketToolsets, PRODUCT_LINES, type Dimension } from '../../shared/market'
import type { Tool } from '../../shared/nova'

type Subtask = { id: string; goal: string; toolset: string }
type WorkerReport = { id: string; goal: string; ok: boolean; summary: string; error?: string }
type Report = { answer: string; subtasks: Subtask[]; workers: WorkerReport[]; partial: boolean }
type Mod = { research(question: string, toolsets: Record<string, Tool[]>): Promise<Report> }

const Q_FULL = 'Mia 要一份竞品调研简报：对比 Nova 与竞品在智能门锁、扫地机器人、智能音箱三条产品线上的价格、核心参数和用户口碑。'
const Q_PART = '老板只关心两件事：智能门锁、扫地机器人、智能音箱三条产品线上，我们和竞品的价格差多少、用户口碑谁更好？'

const QUESTIONS: { text: string; dims: Dimension[] }[] = [
  { text: Q_FULL, dims: ['pricing', 'specs', 'reviews'] },
  { text: Q_PART, dims: ['pricing', 'reviews'] },
]

const GOALS: Record<Dimension, string> = {
  pricing: '查清三条产品线上 Nova 与主要竞品的售价',
  specs: '对比三条产品线上 Nova 与竞品的核心参数',
  reviews: '汇总三条产品线上 Nova 与竞品的用户口碑',
}

const ALL_DIMS = Object.keys(DIMENSIONS) as Dimension[]
const dimOfTool = (name: string) => ALL_DIMS.find((d) => DIMENSIONS[d].tool === name)

type State = { plan?: { id: string; goal: string; dim: Dimension }[]; outputs?: string[] }

/** worker：拿到子任务后调工具，再根据提示词决定“写摘要”还是“把原文全贴回去” */
function worker(req: ChatRequest, ctx: Parameters<LevelSuite['mock']>[1], st: State) {
  const tools = req.tools ?? []
  const first = firstUserText(req)
  const planned = st.plan?.find((p) => first.includes(p.goal))
  const dims = planned ? [planned.dim] : tools.map((t) => dimOfTool(t.name)).filter((d): d is Dimension => !!d)
  const results = allToolResults(req)

  if (!results.length) {
    if (ctx.scenario === 'worker-fails' && dims.length === 1 && dims[0] === 'reviews')
      throw new LLMError('400 invalid_request_error: prompt is too long（评价数据过多，输入超出模型上下文窗口）', 400, false)
    const calls = dims
      .filter((d) => tools.some((t) => t.name === DIMENSIONS[d].tool))
      .flatMap((d) => PRODUCT_LINES.map((line) => ({ name: DIMENSIONS[d].tool, input: { product_line: line } })))
    if (!calls.length) return say('我没有完成这个子任务所需的工具。')
    return callTools(ctx, calls, '三条产品线我同时查。')
  }

  const instructions = `${req.system ?? ''}\n${first}`
  let output: string
  if (/摘要|要点|总结|精简|summary/i.test(instructions)) {
    const byDim = new Map<Dimension, string[]>()
    for (const r of results) {
      const m = r.content.match(/\[RAW-(\w+):(.+?)\]/)
      const fact = r.content.match(/要点：(.+?)。/)
      const dim = ALL_DIMS.find((d) => DIMENSIONS[d].marker === `[RAW-${m?.[1]}`)
      if (!m || !fact || !dim) continue
      byDim.set(dim, [...(byDim.get(dim) ?? []), `${m[2]}：${fact[1]}`])
    }
    output = [...byDim].map(([d, items]) => `【${DIMENSIONS[d].label}】${items.join('；')}。`).join('\n')
  } else {
    output = `调研结果原文如下：\n${results.map((r) => r.content).join('\n')}`
  }
  st.outputs = [...(st.outputs ?? []), output]
  return say(output)
}

function synthesize(visible: string, st: State) {
  const parts: string[] = []
  for (const p of st.plan ?? []) {
    const { label } = DIMENSIONS[p.dim]
    const out = (st.outputs ?? []).find((o) => o.includes(`【${label}】`) && visible.includes(o))
    if (out) parts.push(out)
    else if ((visible.includes(p.goal) || visible.includes(p.id)) && /失败|fail|error/i.test(visible))
      parts.push(`【${label}】⚠ 数据缺失：该子任务未能完成，建议人工补充后再下结论。`)
  }
  return say(`# Nova 竞品调研简报\n\n${parts.join('\n')}\n\n结论：Nova 在功能上有差异化优势，价格处于中间档位。`)
}

function planner(visible: string, st: State) {
  if (!/json/i.test(visible)) return say('我建议从价格、参数和口碑三个方向分别调研。')
  const q = QUESTIONS.find((x) => visible.includes(x.text))
  // 只会分配请求里出现过的工具集名称——编排者必须知道有哪些工具集
  const dims = (q?.dims ?? []).filter((d) => new RegExp(`\\b${DIMENSIONS[d].toolset}\\b`).test(visible))
  st.plan = dims.map((d) => ({ id: d, goal: GOALS[d], dim: d }))
  const subtasks = st.plan.map((p) => ({ id: p.id, goal: p.goal, toolset: DIMENSIONS[p.dim].toolset }))
  return say(`拆解如下：\n\`\`\`json\n${JSON.stringify({ subtasks }, null, 2)}\n\`\`\``)
}

async function runResearch(ctx: ScenarioCtx, question: string): Promise<Report> {
  const { research } = ctx.load<Mod>('agents/orchestrator.ts')
  try {
    return await research(question, marketToolsets(createMarket()))
  } catch (e) {
    return ctx.fail(`research() 抛出了异常：${(e as Error).message}`)
  }
}

/** 按 worker 分组：每个 worker 的工具集不同，用工具名区分 */
function workerCalls(ctx: ScenarioCtx) {
  const groups = new Map<string, ReturnType<ScenarioCtx['trace']['llmCalls']>>()
  for (const c of ctx.trace.llmCalls()) {
    if (!c.request.tools?.length) continue
    const key = c.request.tools.map((t) => t.name).sort().join(',')
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  return groups
}

function checkPlanned(ctx: ScenarioCtx, r: Report, n: number) {
  const first = ctx.trace.llmCalls()[0]
  ctx.assert(first && !first.request.tools?.length, '第一次模型调用应该是编排者拆解任务（不带工具），而不是直接让一个 Agent 拿着所有工具去干')
  ctx.eq(r.subtasks?.length, n, `编排者应该拆出 ${n} 个子任务，并在结果的 subtasks 里返回（请求里要列出可用的工具集名称：web / specs / reviews）`)
  ctx.eq(r.workers?.length, n, '每个子任务对应一个 worker，结果的 workers 里要有每个 worker 的报告')
}

export const suite: LevelSuite = {
  budgets: { calls: 29, tokens: 27000 },
  mock(req, ctx) {
    const st = ctx.state as State
    if (req.tools?.length) return worker(req, ctx, st)
    const visible = visibleText(req)
    if ((st.outputs ?? []).some((o) => visible.includes(o)) || (st.plan && /失败|fail|error/i.test(visible))) return synthesize(visible, st)
    return planner(visible, st)
  },
  scenarios: [
    {
      id: 'brief',
      title: '编排 → 并行 worker → 汇总',
      async run(ctx: ScenarioCtx) {
        const r = await runResearch(ctx, Q_FULL)
        checkPlanned(ctx, r, 3)
        ctx.assert(r.workers.every((w) => w.ok), `所有 worker 都应成功：${JSON.stringify(r.workers.map((w) => [w.id, w.ok, w.error]))}`)
        ctx.eq(r.partial, false, '所有子任务都成功时 partial 应为 false')

        const groups = workerCalls(ctx)
        ctx.eq([...groups.keys()].sort(), ['get_reviews', 'get_spec_sheet', 'web_search'], '每个 worker 只能拿到自己子任务对应的那一个工具集（toolsets[subtask.toolset]），不要把所有工具都给它')

        const starts = [...groups.values()].map((calls) => calls[0].t)
        ctx.assert(new Set(starts).size === 1, `worker 应该并行启动（Promise.all），实际启动时间：${starts.join(' / ')} ms`)
        const durations = [...groups.values()].map((calls) => calls.at(-1)!.t + calls.at(-1)!.durationMs - calls[0].t)
        ctx.assert(ctx.now() < starts[0] + durations.reduce((a, b) => a + b, 0), '总耗时应约等于最慢的 worker，而不是所有 worker 之和')

        for (const d of ['pricing', 'specs', 'reviews'] as Dimension[])
          for (const line of PRODUCT_LINES) {
            const key = FACTS[d][line].split('，')[0]
            ctx.includes(r.answer, key, `最终简报应覆盖每个子任务（缺少 ${line} 的${DIMENSIONS[d].label}信息）`)
          }
      },
    },
    {
      id: 'isolation',
      title: '上下文隔离 + 只传摘要',
      async run(ctx: ScenarioCtx) {
        const r = await runResearch(ctx, Q_FULL)
        checkPlanned(ctx, r, 3)
        for (const [key, calls] of workerCalls(ctx)) {
          const own = dimOfTool(key)
          for (const c of calls) {
            const text = visibleText(c.request)
            for (const d of ALL_DIMS)
              if (d !== own)
                ctx.assert(!text.includes(DIMENSIONS[d].marker), `${key} 这个 worker 的上下文里出现了别的 worker 的原始数据（${DIMENSIONS[d].label}）。每个 worker 要用全新的 messages 独立运行`)
          }
        }
        for (const w of r.workers)
          ctx.assert(!w.summary.includes('[RAW-'), `worker ${w.id} 回传的是原始数据而不是摘要。worker 的提示词要要求它“只返回精简的要点摘要”`)

        const synth = ctx.trace.llmCalls().at(-1)!
        ctx.assert(!synth.request.tools?.length, '最后一次调用应该是编排者汇总（不带工具）')
        const synthText = visibleText(synth.request)
        ctx.assert(!synthText.includes('[RAW-'), '汇总请求里出现了原始工具输出。只把每个 worker 的摘要（r.output）交给编排者，不要传 messages')
        for (const w of r.workers) ctx.includes(synthText, w.summary.slice(0, 20), `汇总请求里要包含 worker ${w.id} 的摘要`)
        const raw = ctx.trace.toolCalls().reduce((n, c) => n + estimateTokens(String(c.output ?? '')), 0)
        const used = synth.response?.usage.input_tokens ?? Infinity
        ctx.assert(used < raw * 0.25, `汇总请求有 ${used} tokens，原始数据一共 ${raw} tokens。摘要应该远小于原文（< 25%）`)
      },
    },
    {
      id: 'dynamic',
      title: '按问题动态拆解',
      async run(ctx: ScenarioCtx) {
        const r = await runResearch(ctx, Q_PART)
        checkPlanned(ctx, r, 2)
        ctx.eq(ctx.trace.toolCalls('specSheet').length, 0, '这个问题不涉及参数，不应该去查规格表——子任务由编排者按问题动态决定')
        ctx.includes(r.answer, 'Nova L2 售价 1299 元', '简报应包含价格调研结果')
        ctx.includes(r.answer, 'Nova R5 好评率 91%', '简报应包含口碑调研结果')
      },
    },
    {
      id: 'worker-fails',
      title: '单个 worker 失败：部分结果',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const r = await runResearch(ctx, Q_FULL)
        checkPlanned(ctx, r, 3)
        const failed = r.workers.find((w) => w.id === 'reviews')
        ctx.assert(failed && !failed.ok, '口碑 worker 的模型调用失败了，它的报告应该是 ok: false')
        ctx.includes(failed.error, 'too long', 'error 里要保留失败原因')
        ctx.eq(r.workers.filter((w) => w.ok).length, 2, '其它 worker 不受影响，应该照常完成（每个 worker 自己 try/catch，别让 Promise.all 整体失败）')
        ctx.eq(r.partial, true, '有子任务失败时，partial 应为 true，提醒调用方结果不完整')
        ctx.includes(r.answer, '数据缺失', '汇总时要告诉编排者哪个子任务失败了（例如“子任务 reviews 失败：原因”），让简报明确标注数据缺失')
        ctx.includes(r.answer, 'Nova R5 吸力 5000Pa', '成功的子任务结果仍然要出现在简报里')
      },
    },
  ],
}
