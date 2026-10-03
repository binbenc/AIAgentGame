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
  /** 正在联系客服的客户 */
  user: SimUser
  /** 商城提供的现成工具：查用户 / 订单 / 商品，取消、修改、退换货，转人工…… */
  tools: Tool[]
  /** 客服政策（Markdown） */
  policy: string
}

/**
 * 零售客服的入口：从 env.user.opening 开始，和客户多轮对话，直到客户结束对话（env.user.done）。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function serve(env: RetailEnv): Promise<void> {
  // 最朴素的版本：能聊起来，但每一轮都是全新的对话（模型记不住客户之前说过什么），
  // 也没有告诉模型任何客服政策——试试看它会闯什么祸。
  let message = env.user.opening
  for (let turn = 0; turn < 10 && !env.user.done; turn++) {
    const res = await runAgent(message, env.tools)
    message = await env.user.respond(res.output)
  }
}
