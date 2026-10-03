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

/** 一“轮”从一条用户发言开始：role 为 user，且不是 tool_result 消息 */
function isTurnStart(m: Message): boolean {
  if (m.role !== 'user') return false
  return typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result')
}

/**
 * 按“轮”切分：最近 keepLastTurns 轮放进 recent（原样保留），更早的放进 older（待摘要）。
 * 只在轮的边界切，所以 recent 一定以用户发言开头，不会出现孤立的 tool_result。
 */
export function splitForCompaction(messages: Message[], keepLastTurns: number): { older: Message[]; recent: Message[] } {
  const keep = Math.max(1, keepLastTurns)
  const starts = messages.flatMap((m, i) => (isTurnStart(m) ? [i] : []))
  if (starts.length <= keep) return { older: [], recent: [...messages] }
  const cut = starts[starts.length - keep]
  return { older: messages.slice(0, cut), recent: messages.slice(cut) }
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

const SUMMARY_SYSTEM = `你是对话摘要助手。请把客服对话压缩成简短的要点摘要，供后续对话继续使用。
- 必须原样保留关键事实：用户姓名、订单号、地址、时间偏好、尚未解决的问题。
- 只写对话里出现过的信息，不要编造。`

export async function summarize(older: Message[]): Promise<string> {
  const res = await chat({
    system: SUMMARY_SYSTEM,
    max_tokens: 300,
    messages: [{ role: 'user', content: `请为以下对话生成摘要：\n\n${renderTranscript(older)}` }],
  })
  return textOf(res.content).trim()
}

export class ChatSession {
  messages: Message[] = []
  private keepLastTurns: number

  constructor(private opts: SessionOptions) {
    this.keepLastTurns = opts.keepLastTurns ?? 4
  }

  /** 下一次请求的 token 数（和计费口径一致：system + messages + tools） */
  contextTokens(): number {
    return countTokens({ system: this.opts.system, messages: this.messages, tools: (this.opts.tools ?? []).map((t) => t.spec) })
  }

  private async compactIfNeeded(): Promise<void> {
    // 超预算才压缩；压缩一次还超，就少保留一轮再压
    for (let keep = this.keepLastTurns; keep >= 1 && this.contextTokens() > this.opts.maxContextTokens; keep--) {
      const { older, recent } = splitForCompaction(this.messages, keep)
      if (!older.length) continue
      const summary = await summarize(older)
      this.messages = [{ role: 'user', content: `${SUMMARY_PREFIX} ${summary}` }, ...recent]
    }
  }

  async send(userText: string): Promise<string> {
    this.messages.push({ role: 'user', content: userText })
    await this.compactIfNeeded()
    const r = await runAgent(this.messages, this.opts.tools ?? [], { system: this.opts.system })
    this.messages = r.messages
    return r.output
  }
}
