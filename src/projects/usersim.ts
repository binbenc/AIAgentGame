/**
 * 模拟用户（τ-bench 的做法）：多轮对话类项目里，由“用户”一方驱动对话。
 * 模拟模式：按确定性脚本回复；真实模式：由 LLM 按人设扮演用户。
 */
import type { Message } from '../engine/llm/types'
import type { EnvCtx } from './types'
import { L } from '../engine/locale'

export const STOP = '###STOP###'

export interface SimUserSpec {
  /** 用户的第一句话 */
  opening: string
  /** 真实模式下给 LLM 的人设说明：身份、目标、已知信息、何时结束 */
  instruction: string
  /** 角色称呼（显示在 trace 里），默认“客户” */
  role?: string
  /** 真实模式下的情境描述，默认“一位正在联系客服的客户” */
  persona?: string
  /** 模拟模式下的脚本：根据客服刚说的话决定怎么回；返回 STOP 表示结束对话 */
  script(agentMessage: string, turn: number, memory: Record<string, unknown>): string
}

export interface SimUser {
  /** 用户的开场白 */
  readonly opening: string
  /** 把客服的话发给用户，拿到用户的回复；回复里包含 ###STOP### 表示用户结束对话 */
  respond(agentMessage: string): Promise<string>
  /** 用户是否已经结束对话 */
  readonly done: boolean
  /** 完整对话记录 */
  readonly transcript: { role: 'agent' | 'user'; text: string }[]
}

const USER_SYSTEM = (instruction: string, persona: string) =>
  L(
    `你在扮演${persona}。下面是你的人设和目标：

${instruction}

规则：
- 每次只说一两句话，像真人一样自然，不要一次把所有信息都说出来；客服问到什么再提供什么。
- 不要编造人设里没有的信息；被问到不知道的事情就说不知道。
- 目标达成，或者确认无法达成时，回复的最后加上 ${STOP}。`,
    `You are playing ${persona}. Here is your persona and goal:

${instruction}

Rules:
- Say only one or two sentences at a time, naturally, like a real person. Don't reveal everything at once; give information when you're asked for it.
- Don't invent anything that isn't in your persona; if asked something you don't know, say you don't know.
- When your goal is achieved, or it's clear it can't be, end your reply with ${STOP}.`,
  )

export function createSimUser(spec: SimUserSpec, ctx: EnvCtx, maxTurns = 30): SimUser {
  const transcript: { role: 'agent' | 'user'; text: string }[] = [{ role: 'user', text: spec.opening }]
  const memory: Record<string, unknown> = {}
  let done = false
  let turn = 0
  const role = spec.role ?? L('客户', 'Customer')
  ctx.log(`👤 ${role}${L('：', ': ')}${spec.opening}`)

  async function reply(agentMessage: string): Promise<string> {
    if (ctx.mode === 'mock' || !ctx.envChat) return spec.script(agentMessage, turn, memory)
    // 真实模式：角色互换——客服说的话对“用户模型”来说是 user 消息
    const messages: Message[] = transcript.map((m) => ({ role: m.role === 'agent' ? 'user' : 'assistant', content: m.text }))
    if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: L('（客服已接入，请开始描述你的问题）', '(An agent has joined the chat. Please describe your issue.)') })
    const res = await ctx.envChat({ system: USER_SYSTEM(spec.instruction, spec.persona ?? L('一位正在联系客服的客户', 'a customer contacting customer support')), messages, max_tokens: 1024, model: 'fast' })
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim() || STOP
  }

  return {
    opening: spec.opening,
    get done() {
      return done
    },
    get transcript() {
      return transcript
    },
    async respond(agentMessage: string) {
      if (done) return STOP
      transcript.push({ role: 'agent', text: agentMessage })
      turn++
      const text = turn > maxTurns ? STOP : await reply(agentMessage)
      transcript.push({ role: 'user', text })
      ctx.log(`👤 ${role}${L('：', ': ')}${text}`)
      if (text.includes(STOP)) done = true
      return text
    },
  }
}
