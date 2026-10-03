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

/**
 * Split by turn: the last keepLastTurns turns go into recent (kept verbatim), everything earlier into older (to be summarized).
 * A turn starts with a user message (role is user, and it is not a tool_result message).
 */
export function splitForCompaction(messages: Message[], keepLastTurns: number): { older: Message[]; recent: Message[] } {
  // TODO: find the index where each turn starts and cut at the start of the keepLastTurns-th turn from the end
  //       with too few turns, older is empty; only cut on turn boundaries, never leave an orphaned tool_result
  throw new Error('TODO: implement splitForCompaction()')
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

export async function summarize(older: Message[]): Promise<string> {
  // TODO: make a separate chat() call that condenses renderTranscript(older) into a summary
  //       the system prompt must say this is a summarization task that keeps key facts: names, order numbers, time preferences
  throw new Error('TODO: implement summarize()')
}

export class ChatSession {
  messages: Message[] = []

  constructor(private opts: SessionOptions) {}

  async send(userText: string): Promise<string> {
    this.messages.push({ role: 'user', content: userText })
    // TODO: before sending, check countTokens({ system, messages, tools }) against maxContextTokens
    //       if over, compact: older → summarize() → one `${SUMMARY_PREFIX} ...` user message, followed by recent
    const r = await runAgent(this.messages, this.opts.tools ?? [], { system: this.opts.system })
    this.messages = r.messages
    return r.output
  }
}
