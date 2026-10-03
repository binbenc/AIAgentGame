import { chat, countTokens, textOf, type Message } from 'agent-quest'
import { runAgent } from './agent'
import type { Tool } from './tools'

export const SUMMARY_PREFIX = '[对话摘要]'

export interface SessionOptions {
  system?: string
  /** 每次请求（system + messages + tools）允许的最大 token 数 */
  maxContextTokens: number
  /** 压缩时原样保留最近几轮对话，默认 4 */
  keepLastTurns?: number
  tools?: Tool[]
}

/**
 * 按“轮”切分：最近 keepLastTurns 轮放进 recent（原样保留），更早的放进 older（待摘要）。
 * 一“轮”从一条用户发言开始（role 为 user，且不是 tool_result 消息）。
 */
export function splitForCompaction(messages: Message[], keepLastTurns: number): { older: Message[]; recent: Message[] } {
  // TODO：找出每一轮的起点下标，在倒数第 keepLastTurns 轮的起点处切开
  //       轮数不够时 older 为空；只能在轮的边界切，不能留下孤立的 tool_result
  throw new Error('TODO：实现 splitForCompaction()')
}

/** 把消息渲染成纯文本对话记录，交给摘要模型 */
export function renderTranscript(messages: Message[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const who = m.role === 'user' ? '用户' : '客服'
    if (typeof m.content === 'string') {
      lines.push(`${who}：${m.content}`)
      continue
    }
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${who}：${b.text}`)
      else if (b.type === 'tool_use') lines.push(`（客服调用工具 ${b.name}：${JSON.stringify(b.input)}）`)
      else if (b.type === 'tool_result') lines.push(`（工具返回：${b.content}）`)
    }
  }
  return lines.join('\n')
}

export async function summarize(older: Message[]): Promise<string> {
  // TODO：单独调用一次 chat()，让模型把 renderTranscript(older) 压缩成摘要
  //       system 里写清楚：这是摘要任务，必须保留姓名、订单号、时间偏好等关键事实
  throw new Error('TODO：实现 summarize()')
}

export class ChatSession {
  messages: Message[] = []

  constructor(private opts: SessionOptions) {}

  async send(userText: string): Promise<string> {
    this.messages.push({ role: 'user', content: userText })
    // TODO：发送前用 countTokens({ system, messages, tools }) 检查是否超出 maxContextTokens
    //       超出就压缩：older → summarize() → 一条 `${SUMMARY_PREFIX} ...` 的 user 消息，后面接 recent
    const r = await runAgent(this.messages, this.opts.tools ?? [], { system: this.opts.system })
    this.messages = r.messages
    return r.output
  }
}
