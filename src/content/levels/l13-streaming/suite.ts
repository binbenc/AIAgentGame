import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { callTool, firstUserText, lastToolResults, say } from '../../../engine/llm/mock-kit'
import { basicNovaTools, createNova, type Tool } from '../../shared/nova'
import { L } from '../../../engine/locale'

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

const ECO = L(
  '智能空调 X1 的节能模式会根据室内外温差自动调节压缩机频率：白天有人时保持 26°C 的舒适温度，检测到房间无人 15 分钟后自动调高 2°C；夜间睡眠模式每小时微调 0.5°C，整晚最多可省电 30%。您可以在 Nova App 的“节能”页面查看每天的用电曲线。',
  "The Smart AC X1's energy-saving mode adjusts the compressor speed based on the indoor/outdoor temperature difference: it holds a comfortable 26°C while people are home, and raises the setpoint by 2°C after detecting an empty room for 15 minutes. At night, sleep mode nudges the temperature by 0.5°C every hour, saving up to 30% of the power overnight. You can see your daily usage curve on the \"Energy\" page of the Nova App.",
)
const VOICE = L(
  '智能空调 X1 支持小爱同学、天猫精灵和 Siri 快捷指令。在 Nova App 的“第三方平台”里绑定账号后，就可以直接说“把空调调到 26 度”。',
  'The Smart AC X1 works with Xiao Ai, Tmall Genie and Siri Shortcuts. Link your account under "Third-party platforms" in the Nova App, then just say "set the AC to 26 degrees".',
)
/** 网关给被取消的调用记录的 error（gateway.ts） */
const CANCELLED = L(/取消/, /^Cancelled/)

function collector(ctx: ScenarioCtx) {
  const deltas: { text: string; t: number }[] = []
  return { deltas, onText: (d: string) => void deltas.push({ text: d, t: ctx.now() }) }
}

function streamedText(ctx: ScenarioCtx, i = 0): string {
  const res = ctx.trace.llmCalls()[i]?.response
  return (res?.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('')
}

export const suite: LevelSuite = {
  budgets: L({ calls: 6, tokens: 880 }, { calls: 6, tokens: 820 }),
  mock(req, ctx) {
    const q = firstUserText(req)
    if (req.tools?.length) {
      const last = lastToolResults(req)
      if (!last.length)
        return callTool(ctx, 'get_shipping', { order_id: q.match(/NV-\d{6}/)?.[0] ?? '' }, L('我帮您查一下物流。', 'Let me check the shipping for you.'))
      const s = JSON.parse(last[0].content)
      return say(
        L(
          `您的订单 ${s.orderId} 由${s.carrier}承运，${s.status}（更新于 ${s.updatedAt}）。`,
          `Your order ${s.orderId} is with ${s.carrier}: ${s.status} (updated ${s.updatedAt}).`,
        ),
      )
    }
    if (/节能|energy/i.test(q)) return say(ECO)
    if (/语音|voice/i.test(q)) {
      // 首字超时场景：第一次请求模型“卡住”了（30 秒才开始吐字），第二次正常但整体较慢
      // （mock 把总延迟平均分给每个流事件；英文回答的事件更多，要更大的总延迟才能让首字晚于 2 秒）
      if (ctx.scenario === 'first-token-timeout') return { ...say(VOICE), latencyMs: ctx.call === 0 ? L(30_000, 120_000) : 4_000 }
      return say(VOICE)
    }
    return say(L('您好，我是 Nova 智能客服，请问有什么可以帮您？', "Hi, I'm the Nova support assistant. How can I help?"))
  },
  scenarios: [
    {
      id: 'stream',
      title: L('边生成边显示', 'Show text as it streams'),
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const { deltas, onText } = collector(ctx)
        const r = await streamAnswer(L('介绍一下智能空调 X1 的节能模式', "Tell me about the Smart AC X1's energy-saving mode"), onText)
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(call?.streamed, L('应该用 chatStream 发起流式请求，而不是 chat', 'Use chatStream for a streaming request, not chat'))
        ctx.assert(
          deltas.length >= 10,
          L(
            `onText 只被调用了 ${deltas.length} 次。应该每收到一个 text_delta 就立刻转发，而不是等全部生成完再一次性给出`,
            `onText was called only ${deltas.length} times. Forward each text_delta as soon as it arrives instead of handing over everything at the end`,
          ),
        )
        ctx.eq(deltas.map((d) => d.text).join(''), r.text, L('所有 delta 拼起来应该等于返回的 text', 'All deltas joined together should equal the returned text'))
        ctx.eq(r.text, streamedText(ctx), L('返回的 text 应该等于模型的完整回答', "The returned text should equal the model's full answer"))
        ctx.assert(
          deltas[0].t < deltas[deltas.length - 1].t,
          L('第一个字应该在生成过程中就送达，而不是在流结束时才一起送达', 'The first token should arrive while generation is still going, not together with everything at the end of the stream'),
        )
        ctx.eq(r.cancelled, false, L('正常结束时 cancelled 应为 false', 'cancelled should be false on normal completion'))
      },
    },
    {
      id: 'cancel',
      title: L('用户点了“停止生成”', 'The user clicks "Stop generating"'),
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const ac = new AbortController()
        let received = ''
        let count = 0
        let countAtAbort = -1
        let r: StreamResult
        try {
          r = await streamAnswer(
            L('介绍一下智能空调 X1 的节能模式', "Tell me about the Smart AC X1's energy-saving mode"),
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
          return ctx.fail(
            L(
              `streamAnswer 抛出了异常：${(e as Error).name}: ${(e as Error).message}\n用户取消不是错误：捕获 AbortError，返回已经生成的部分并标记 cancelled: true`,
              `streamAnswer threw: ${(e as Error).name}: ${(e as Error).message}\nA user cancellation is not an error: catch the AbortError, return the partial text and set cancelled: true`,
            ),
          )
        }
        ctx.eq(r.cancelled, true, L('用户取消后应返回 cancelled: true', 'Return cancelled: true after the user cancels'))
        ctx.eq(
          count,
          countAtAbort,
          L(
            `取消之后又收到了 ${count - countAtAbort} 个 delta——取消后不应该再往界面上推送文字`,
            `${count - countAtAbort} more deltas arrived after cancelling. Nothing should be pushed to the UI after a cancel`,
          ),
        )
        ctx.eq(r.text, received, L('返回的 text 应该是取消前已经推送给用户的部分', 'The returned text should be what was pushed to the user before the cancel'))
        ctx.assert(r.text.length < ECO.length, L('取消后不应该拿到完整回答', 'A cancelled request should not get the full answer'))
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(
          call && CANCELLED.test(call.error ?? ''),
          L(
            '请求应该被真正中止（trace 里这次调用应显示“已取消”）：把 signal 传给 chatStream(req, { signal })，而不是只在本地停止读取——否则模型会继续生成，token 照样计费',
            'The request should really be aborted (the trace should show this call as "Cancelled"): pass the signal to chatStream(req, { signal }) instead of just stopping reading locally. Otherwise the model keeps generating and you still pay for the tokens',
          ),
        )
      },
    },
    {
      id: 'first-token-timeout',
      title: L('首字超时', 'First-token timeout'),
      mockOnly: true,
      async run(ctx: ScenarioCtx) {
        const { streamAnswer } = ctx.load<Mod>('streaming.ts')
        const a = collector(ctx)
        const VOICE_Q = L('空调 X1 支持哪些语音助手？', 'Which voice assistants does the AC X1 work with?')
        const r1 = await streamAnswer(VOICE_Q, a.onText, { firstTokenTimeoutMs: 2000 })
        ctx.eq(r1.timedOut, true, L('2 秒内没收到第一个字，应该中止请求并返回 timedOut: true', 'No token within 2 seconds: abort the request and return timedOut: true'))
        ctx.eq(a.deltas.length, 0, L('超时的请求不应该再推送文字', 'A timed-out request should not push any text'))
        ctx.assert(
          ctx.now() < 30_000,
          L(
            `等了 ${ctx.now()}ms 才返回——首字超时应该用 sleep(ms, signal) 计时，到点就 abort 请求`,
            `It took ${ctx.now()}ms to return. Time the first token with sleep(ms, signal) and abort the request when it fires`,
          ),
        )
        ctx.assert(
          CANCELLED.test(ctx.trace.llmCalls()[0]?.error ?? ''),
          L('超时后应该真正中止请求：abort 传给 chatStream 的 signal', 'After the timeout, really abort the request: abort the signal passed to chatStream'),
        )

        const b = collector(ctx)
        const r2 = await streamAnswer(VOICE_Q, b.onText, { firstTokenTimeoutMs: 2000 })
        ctx.assert(
          !r2.timedOut && !r2.cancelled,
          L(
            '第二次请求整体要 4 秒，但首字很快就到了——收到首字后就要取消超时计时器，不能把正常的长回答也掐断',
            "The second request takes 4 seconds in total, but the first token arrives quickly. Cancel the timeout timer once the first token arrives so normal long answers don't get cut off",
          ),
        )
        ctx.eq(r2.text, VOICE, L('第二次请求应该拿到完整回答', 'The second request should get the full answer'))
      },
    },
    {
      id: 'agent-progress',
      title: L('流式 Agent：工具进度提示', 'Streaming agent: tool progress updates'),
      async run(ctx: ScenarioCtx) {
        const { streamAgent } = ctx.load<Mod>('streaming.ts')
        const statuses: { s: string; toolsDone: number }[] = []
        let text = ''
        const r = await streamAgent(L('NV-100001 到哪了？', "Where's NV-100001?"), basicNovaTools(createNova()), {
          onText: (d) => void (text += d),
          onStatus: (s) => void statuses.push({ s, toolsDone: ctx.trace.toolCalls().length }),
        })
        const hit = statuses.find((x) => x.s.includes('get_shipping'))
        ctx.assert(
          hit,
          L(
            `收到 tool_use_start 时应该推送进度，例如“正在调用工具 get_shipping…”（实际：${JSON.stringify(statuses.map((x) => x.s))}）`,
            `Push a progress update on tool_use_start, e.g. "Calling tool get_shipping…" (actual: ${JSON.stringify(statuses.map((x) => x.s))})`,
          ),
        )
        ctx.eq(
          hit.toolsDone,
          0,
          L(
            '进度提示应该在模型刚决定调用工具时（tool_use_start）就推送，而不是等工具执行完',
            'Push the progress update as soon as the model decides to call a tool (tool_use_start), not after the tool finishes',
          ),
        )
        const STATUS = L('上海转运中心', 'Shanghai transit hub')
        ctx.includes(r.output, STATUS, L('最终回答应包含物流状态', 'The final answer should include the shipping status'))
        ctx.includes(text, STATUS, L('最终回答也要通过 onText 流式推送', 'The final answer should also be streamed through onText'))
        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 2, L('应该是 2 轮：调用工具 → 回答', 'Expected 2 turns: call the tool → answer'))
        ctx.assert(calls.every((c) => c.streamed), L('Agent 的每一轮都应该用 chatStream', 'Every agent turn should use chatStream'))
      },
    },
  ],
}
