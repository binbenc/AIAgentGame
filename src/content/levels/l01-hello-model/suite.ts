import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { lastUserText, say } from '../../../engine/llm/mock-kit'
import type { ContentBlock } from '../../../engine/llm/types'
import { L } from '../../../engine/locale'

const thinking: ContentBlock = { type: 'opaque', provider: 'mock', raw: { type: 'thinking', thinking: '', signature: 'mock-sig' } }

const LONG = L(
  'AI Agent 的核心是一个循环：模型根据上下文决定下一步行动，调用工具，观察结果，再决定下一步。',
  'At its core, an AI agent is a loop: the model decides the next action from the context, calls a tool, observes the result, then decides again. ',
).repeat(8)

interface AskResult {
  text: string
  usage: { input_tokens: number; output_tokens: number }
  truncated: boolean
}
type LlmModule = {
  ask(q: string, o?: { system?: string; maxTokens?: number }): Promise<AskResult>
  askNova(q: string): Promise<AskResult>
}

export const suite: LevelSuite = {
  budgets: L({ calls: 4, tokens: 240 }, { calls: 4, tokens: 190 }),
  mock(req) {
    const q = lastUserText(req)
    if (/你是谁|who are you/i.test(q)) {
      const text = req.system?.includes('Nova')
        ? L('你好！我是 Nova 科技的智能客服 Nova Bot，有什么可以帮你？', "Hi! I'm Nova Bot, Nova Tech's support assistant. How can I help?")
        : L('我是一个通用 AI 语言模型。', "I'm a general-purpose AI language model.")
      return { content: [thinking, { type: 'text', text }] }
    }
    if (q.includes('1+1')) return { content: [thinking, { type: 'text', text: '1+1 ' }, { type: 'text', text: L('等于 2。', 'equals 2.') }] }
    if (/长文|long essay/i.test(q)) return say(LONG)
    if (/首都|capital/i.test(q)) return say(L('法国的首都是巴黎。', 'The capital of France is Paris.'))
    return say(L(`收到：${q}`, `Got it: ${q}`))
  },
  scenarios: [
    {
      id: 'basic',
      title: L('基础问答', 'Basic Q&A'),
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask(L('法国的首都是哪里？', 'What is the capital of France?'))
        ctx.includes(r.text, L('巴黎', 'Paris'), L('回答里应该包含“巴黎”', 'The answer should contain "Paris"'))
        ctx.assert(r.usage && r.usage.input_tokens > 0 && r.usage.output_tokens > 0, L('usage 应该原样返回响应中的 token 用量', "usage should be the response's token usage, returned as is"))
        ctx.eq(r.truncated, false, L('正常结束时 truncated 应为 false', 'truncated should be false when the answer ends normally'))
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(call, L('应该调用一次 chat()', 'chat() should be called once'))
        ctx.eq(call.request.messages.length, 1, L('应该只发送一条 user 消息', 'Send exactly one user message'))
      },
    },
    {
      id: 'persona',
      title: L('人设：Nova 客服', 'Persona: Nova support'),
      async run(ctx: ScenarioCtx) {
        const { askNova } = ctx.load<LlmModule>('llm.ts')
        const r = await askNova(L('你是谁？', 'Who are you?'))
        const call = ctx.trace.llmCalls()[0]
        ctx.includes(call?.request.system ?? '', 'Nova', L('system prompt 里应该说明“Nova 科技客服助手”的身份', "The system prompt should state the identity: Nova Tech's support assistant"))
        ctx.includes(r.text, 'Nova', L('模型应该以 Nova 客服的身份自我介绍', 'The model should introduce itself as Nova support'))
      },
    },
    {
      id: 'multi-block',
      title: L('多内容块', 'Multiple content blocks'),
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask(L('1+1 等于几？', 'What is 1+1?'))
        ctx.eq(
          r.text,
          L('1+1 等于 2。', '1+1 equals 2.'),
          L('需要按 type 过滤并拼接所有 text 块（第一个块是 thinking，不是文本）', 'Filter by type and join all text blocks (the first block is thinking, not text)'),
        )
      },
    },
    {
      id: 'truncated',
      title: L('截断检测', 'Truncation detection'),
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask(L('写一篇关于 Agent 的长文', 'Write a long essay about agents'), { maxTokens: 40 })
        const call = ctx.trace.llmCalls()[0]
        ctx.eq(call?.request.max_tokens, 40, L('maxTokens 应该作为 max_tokens 传给 chat()', 'Pass maxTokens to chat() as max_tokens'))
        ctx.eq(r.truncated, true, L('stop_reason 为 max_tokens 时，truncated 应为 true', 'truncated should be true when stop_reason is max_tokens'))
      },
    },
  ],
}
