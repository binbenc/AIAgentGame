import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstUserText, lastToolResults, say } from '../../../engine/llm/mock-kit'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'

type StreamResult = { text: string; cancelled: boolean; timedOut?: boolean }
type Mod = {
  streamAnswer(q: string, onText: (d: string) => void, opts?: { signal?: AbortSignal; firstTokenTimeoutMs?: number }): Promise<StreamResult>
  streamAgent(
    task: string,
    tools: Tool[],
    cb: { onText?(d: string): void; onStatus?(s: string): void },
    opts?: object,
  ): Promise<{ output: string }>
}

const ECO =
  '智能空调 X1 的节能模式会根据室内外温差自动调节压缩机频率：白天有人时保持 26°C 的舒适温度，检测到房间无人 15 分钟后自动调高 2°C；夜间睡眠模式每小时微调 0.5°C，整晚最多可省电 30%。您可以在 Nova App 的“节能”页面查看每天的用电曲线。'
const VOICE = '智能空调 X1 支持小爱同学、天猫精灵和 Siri 快捷指令。在 Nova App 的“第三方平台”里绑定账号后，就可以直接说“把空调调到 26 度”。'

function collector(ctx: ScenarioCtx) {
  const deltas: { text: string; t: number }[] = []
  return { deltas, onText: (d: string) => void deltas.push({ text: d, t: ctx.now() }) }
}

function streamedText(ctx: ScenarioCtx, i = 0): string {
  const res = ctx.trace.llmCalls()[i]?.response
  return (res?.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('')
}

export const suite: LevelSuite = {
  budgets: { calls: 6, tokens: 880 },
  mock(req, ctx) {
    const q = firstUserText(req)
    if (req.tools?.length) {
      const last = lastToolResults(req)
      if (!last.length) return callTool(ctx, 'get_shipping', { order_id: q.match(/NV-\d{6}/)?.[0] ?? '' }, '我帮您查一下物流。')
      const s = JSON.parse(last[0].content)
      return say(`您的订单 ${s.orderId} 由${s.carrier}承运，${s.status}（更新于 ${s.updatedAt}）。`)
    }
    if (/节能/.test(q)) return say(ECO)
    if (/语音/.test(q)) {
      // 首字超时场景：第一次请求模型“卡住”了（30 秒才开始吐字），第二次正常但整体较慢
      if (ctx.scenario === 'first-token-timeout') return { ...say(VOICE), latencyMs: ctx.call === 0 ? 30_000 : 4_000 }
      return say(VOICE)
    }
    return say('您好，我是 Nova 智能客服，请问有什么可以帮您？')
  },
  scenarios: [
    {
      id: 'stream',
      title: '边生成边显示',
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const { deltas, onText } = collector(ctx)
        const r = await streamAnswer('介绍一下智能空调 X1 的节能模式', onText)
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(call?.streamed, '应该用 chatStream 发起流式请求，而不是 chat')
        ctx.assert(deltas.length >= 10, `onText 只被调用了 ${deltas.length} 次。应该每收到一个 text_delta 就立刻转发，而不是等全部生成完再一次性给出`)
        ctx.eq(deltas.map((d) => d.text).join(''), r.text, '所有 delta 拼起来应该等于返回的 text')
        ctx.eq(r.text, streamedText(ctx), '返回的 text 应该等于模型的完整回答')
        ctx.assert(deltas[0].t < deltas[deltas.length - 1].t, '第一个字应该在生成过程中就送达，而不是在流结束时才一起送达')
        ctx.eq(r.cancelled, false, '正常结束时 cancelled 应为 false')
      },
    },
    {
      id: 'cancel',
      title: '用户点了“停止生成”',
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const ac = new AbortController()
        let received = ''
        let count = 0
        let countAtAbort = -1
        let r: StreamResult
        try {
          r = await streamAnswer(
            '介绍一下智能空调 X1 的节能模式',
            (d) => {
              received += d
              count++
              if (received.length >= 30 && !ac.signal.aborted) {
                ac.abort()
                countAtAbort = count
              }
            },
            { signal: ac.signal },
          )
        } catch (e) {
          return ctx.fail(`streamAnswer 抛出了异常：${(e as Error).name}: ${(e as Error).message}\n用户取消不是错误：捕获 AbortError，返回已经生成的部分并标记 cancelled: true`)
        }
        ctx.eq(r.cancelled, true, '用户取消后应返回 cancelled: true')
        ctx.eq(count, countAtAbort, `取消之后又收到了 ${count - countAtAbort} 个 delta——取消后不应该再往界面上推送文字`)
        ctx.eq(r.text, received, '返回的 text 应该是取消前已经推送给用户的部分')
        ctx.assert(r.text.length < ECO.length, '取消后不应该拿到完整回答')
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(
          call && /取消/.test(call.error ?? ''),
          '请求应该被真正中止（trace 里这次调用应显示“已取消”）：把 signal 传给 chatStream(req, { signal })，而不是只在本地停止读取——否则模型会继续生成，token 照样计费',
        )
      },
    },
    {
      id: 'first-token-timeout',
      title: '首字超时',
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const a = collector(ctx)
        const r1 = await streamAnswer('空调 X1 支持哪些语音助手？', a.onText, { firstTokenTimeoutMs: 2000 })
        ctx.eq(r1.timedOut, true, '2 秒内没收到第一个字，应该中止请求并返回 timedOut: true')
        ctx.eq(a.deltas.length, 0, '超时的请求不应该再推送文字')
        ctx.assert(ctx.now() < 30_000, `等了 ${ctx.now()}ms 才返回——首字超时应该用 sleep(ms, signal) 计时，到点就 abort 请求`)
        ctx.assert(/取消/.test(ctx.trace.llmCalls()[0]?.error ?? ''), '超时后应该真正中止请求：abort 传给 chatStream 的 signal')

        const b = collector(ctx)
        const r2 = await streamAnswer('空调 X1 支持哪些语音助手？', b.onText, { firstTokenTimeoutMs: 2000 })
        ctx.assert(!r2.timedOut && !r2.cancelled, '第二次请求整体要 4 秒，但首字很快就到了——收到首字后就要取消超时计时器，不能把正常的长回答也掐断')
        ctx.eq(r2.text, VOICE, '第二次请求应该拿到完整回答')
      },
    },
    {
      id: 'agent-progress',
      title: '流式 Agent：工具进度提示',
      async run(ctx: ScenarioCtx) {
        const { streamAgent } = ctx.load<Mod>('streaming.ts')
        const statuses: { s: string; toolsDone: number }[] = []
        let text = ''
        const r = await streamAgent('NV-100001 到哪了？', basicNovaTools(createNova()), {
          onText: (d) => void (text += d),
          onStatus: (s) => void statuses.push({ s, toolsDone: ctx.trace.toolCalls().length }),
        })
        const hit = statuses.find((x) => x.s.includes('get_shipping'))
        ctx.assert(hit, `收到 tool_use_start 时应该推送进度，例如“正在调用工具 get_shipping…”（实际：${JSON.stringify(statuses.map((x) => x.s))}）`)
        ctx.eq(hit.toolsDone, 0, '进度提示应该在模型刚决定调用工具时（tool_use_start）就推送，而不是等工具执行完')
        ctx.includes(r.output, '上海转运中心', '最终回答应包含物流状态')
        ctx.includes(text, '上海转运中心', '最终回答也要通过 onText 流式推送')
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, '应该是 2 轮：调用工具 → 回答')
        ctx.assert(calls.every((c) => c.streamed), 'Agent 的每一轮都应该用 chatStream')
      },
    },
  ],
}
