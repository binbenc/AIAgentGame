import { chat, countTokens, textOf, type Message } from 'agent-quest'
import { runAgent } from './agent'
import type { Tool } from './tools'

export const SUMMARY_PREFIX = '[Conversation summary]'

export interface SessionOptions {
  system?: string
  /** Max tokens allowed per request (system + messages + tools) */
  maxContextTokens: number
  /** How many recent turns to keep verbatim when compacting (default 4) */
  keepLastTurns?: number
  tools?: Tool[]
}

/** A turn starts with a user message: role is user, and it is not a tool_result message */
function isTurnStart(m: Message): boolean {
  if (m.role !== 'user') return false
  return typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result')
}

/**
 * Split by turn: the last keepLastTurns turns go into recent (kept verbatim), everything earlier into older (to be summarized).
 * We only cut on turn boundaries, so recent always starts with a user message and never has an orphaned tool_result.
 */
export function splitForCompaction(messages: Message[], keepLastTurns: number): { older: Message[]; recent: Message[] } {
  const keep = Math.max(1, keepLastTurns)
  const starts = messages.flatMap((m, i) => (isTurnStart(m) ? [i] : []))
  if (starts.length <= keep) return { older: [], recent: [...messages] }
  const cut = starts[starts.length - keep]
  return { older: messages.slice(0, cut), recent: messages.slice(cut) }
}

/** Render messages as a plain-text transcript for the summarizer */
export function renderTranscript(messages: Message[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const who = m.role === 'user' ? 'User' : 'Agent'
    if (typeof m.content === 'string') {
      lines.push(`${who}: ${m.content}`)
      continue
    }
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${who}: ${b.text}`)
      else if (b.type === 'tool_use') lines.push(`(Agent called tool ${b.name}: ${JSON.stringify(b.input)})`)
      else if (b.type === 'tool_result') lines.push(`(Tool returned: ${b.content})`)
    }
  }
  return lines.join('\n')
}

const SUMMARY_SYSTEM = `You summarize conversations. Condense the support conversation into a short bullet summary that the rest of the conversation can build on.
- Keep key facts exactly as stated: the user's name, order numbers, addresses, time preferences, open issues.
- Only include information that appears in the conversation. Don't make anything up.`

export async function summarize(older: Message[]): Promise<string> {
  const res = await chat({
    system: SUMMARY_SYSTEM,
    max_tokens: 300,
    messages: [{ role: 'user', content: `Summarize this conversation:\n\n${renderTranscript(older)}` }],
  })
  return textOf(res.content).trim()
}

export class ChatSession {
  messages: Message[] = []
  private keepLastTurns: number

  constructor(private opts: SessionOptions) {
    this.keepLastTurns = opts.keepLastTurns ?? 4
  }

  /** Token count of the next request (same as billing: system + messages + tools) */
  contextTokens(): number {
    return countTokens({ system: this.opts.system, messages: this.messages, tools: (this.opts.tools ?? []).map((t) => t.spec) })
  }

  private async compactIfNeeded(): Promise<void> {
    // Only compact when over budget; if one pass isn't enough, keep one turn fewer and compact again
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
