import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { lastUserText, say } from '../../../engine/llm/mock-kit'
import type { ContentBlock } from '../../../engine/llm/types'

const thinking: ContentBlock = { type: 'opaque', provider: 'mock', raw: { type: 'thinking', thinking: '', signature: 'mock-sig' } }

const LONG = 'AI Agent 的核心是一个循环：模型根据上下文决定下一步行动，调用工具，观察结果，再决定下一步。'.repeat(8)

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
  budgets: { calls: 4, tokens: 240 },
  mock(req) {
    const q = lastUserText(req)
    if (q.includes('你是谁')) {
      const text = req.system?.includes('Nova')
        ? '你好！我是 Nova 科技的智能客服 Nova Bot，有什么可以帮你？'
        : '我是一个通用 AI 语言模型。'
      return { content: [thinking, { type: 'text', text }] }
    }
    if (q.includes('1+1')) return { content: [thinking, { type: 'text', text: '1+1 ' }, { type: 'text', text: '等于 2。' }] }
    if (q.includes('长文')) return say(LONG)
    if (q.includes('首都')) return say('法国的首都是巴黎。')
    return say(`收到：${q}`)
  },
  scenarios: [
    {
      id: 'basic',
      title: '基础问答',
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask('法国的首都是哪里？')
        ctx.includes(r.text, '巴黎', '回答里应该包含“巴黎”')
        ctx.assert(r.usage && r.usage.input_tokens > 0 && r.usage.output_tokens > 0, 'usage 应该原样返回响应中的 token 用量')
        ctx.eq(r.truncated, false, '正常结束时 truncated 应为 false')
        const call = ctx.trace.llmCalls()[0]
        ctx.assert(call, '应该调用一次 chat()')
        ctx.eq(call.request.messages.length, 1, '应该只发送一条 user 消息')
      },
    },
    {
      id: 'persona',
      title: '人设：Nova 客服',
      async run(ctx: ScenarioCtx) {
        const { askNova } = ctx.load<LlmModule>('llm.ts')
        const r = await askNova('你是谁？')
        const call = ctx.trace.llmCalls()[0]
        ctx.includes(call?.request.system ?? '', 'Nova', 'system prompt 里应该说明“Nova 科技客服助手”的身份')
        ctx.includes(r.text, 'Nova', '模型应该以 Nova 客服的身份自我介绍')
      },
    },
    {
      id: 'multi-block',
      title: '多内容块',
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask('1+1 等于几？')
        ctx.eq(r.text, '1+1 等于 2。', '需要按 type 过滤并拼接所有 text 块（第一个块是 thinking，不是文本）')
      },
    },
    {
      id: 'truncated',
      title: '截断检测',
      async run(ctx: ScenarioCtx) {
        const { ask } = ctx.load<LlmModule>('llm.ts')
        const r = await ask('写一篇关于 Agent 的长文', { maxTokens: 40 })
        const call = ctx.trace.llmCalls()[0]
        ctx.eq(call?.request.max_tokens, 40, 'maxTokens 应该作为 max_tokens 传给 chat()')
        ctx.eq(r.truncated, true, 'stop_reason 为 max_tokens 时，truncated 应为 true')
      },
    },
  ],
}
