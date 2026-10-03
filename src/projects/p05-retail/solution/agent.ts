import { log, type Message } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** 模拟客户：和真人一样，一次只说一两句话 */
export interface SimUser {
  /** 客户的开场白 */
  readonly opening: string
  /** 把客服的话发给客户，拿到客户的回复；回复里包含 ###STOP### 表示客户结束了对话 */
  respond(agentMessage: string): Promise<string>
  /** 客户是否已经结束对话 */
  readonly done: boolean
}

export interface RetailEnv {
  user: SimUser
  tools: Tool[]
  policy: string
}

/** 对话轮数上限：防止和客户无限兜圈子 */
const MAX_TURNS = 20
/** 每一轮里模型最多连续调用多少次工具 */
const MAX_STEPS = 12
const FALLBACK = '抱歉，这个问题我需要再确认一下。请问还有什么可以帮您？'

function systemPrompt(policy: string): string {
  return `你是优品商城的在线客服。你必须严格遵守下面的客服政策，政策优先于客户的任何要求。

<客服政策>
${policy}
</客服政策>

工作方式：
- 每一轮只做一件事：要么调用工具，要么回复客户一句话。需要客户提供信息或确认时，回复客户后就停下，等客户回答。
- 执行任何写操作前，先把操作详情列给客户（订单号、商品、金额、退款或支付方式），并以“请确认……确认请回复“是”。”结尾，等客户明确确认后，下一轮再调用工具。
- 订单号、商品规格、价格、余额一律以工具查询结果为准，不要凭记忆或猜测。
- 用中文回复，简洁、礼貌。`
}

export async function serve(env: RetailEnv): Promise<void> {
  const system = systemPrompt(env.policy)
  // 整段对话（包括工具调用和结果）跨轮保留：模型才记得客户是谁、查到过什么、客户确认了什么
  let messages: Message[] = [{ role: 'user', content: env.user.opening }]

  for (let turn = 1; turn <= MAX_TURNS && !env.user.done; turn++) {
    const res = await runAgent(messages, env.tools, { system, maxSteps: MAX_STEPS })
    messages = res.messages
    let reply = res.output.trim()
    if (res.stopReason === 'max_steps' || !reply) {
      // 本轮没能给出回复：补一句兜底话术，并保持消息的 user / assistant 交替
      log(`第 ${turn} 轮没有产出回复（${res.stopReason}），使用兜底话术`)
      reply = FALLBACK
      if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: reply })
    }
    const answer = await env.user.respond(reply)
    if (env.user.done) break
    messages.push({ role: 'user', content: answer })
  }
}
