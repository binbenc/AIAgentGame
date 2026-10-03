import { now } from 'agent-quest'
import { runAgent, type AgentResult } from './agent'
import type { Tool } from './tools'

export interface MemoryItem {
  id: string
  userId: string
  fact: string
  createdAt: number
}

/**
 * A simple bilingual tokenizer: English words and numbers stay whole, Chinese is split into character bigrams.
 * e.g. "Smart Lock L2" → ['smart', 'lock', 'l2'], "上门安装" → ['上门', '门安', '安装']. Duplicates are kept so term frequency can be counted later.
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const [run] of text.toLowerCase().matchAll(/[a-z0-9]+|[一-鿿]+/g)) {
    if (/^[a-z0-9]/.test(run) || run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/** Check for sensitive data that must never go into long-term memory; return the reason if found */
export function containsSecret(text: string): string | null {
  if (/\d(?:[\s-]?\d){12,18}/.test(text)) return 'looks like a card or ID number'
  if (/密码|口令|password|passwd|cvv|验证码/i.test(text)) return 'password or verification code'
  return null
}

export class MemoryStore {
  private items: MemoryItem[] = []
  private seq = 0

  remember(userId: string, fact: string): MemoryItem {
    const text = fact.trim()
    const reason = containsSecret(text)
    if (reason) throw new Error(`Refused to save: the content contains sensitive information (${reason}). Never put passwords, card numbers or ID numbers into long-term memory.`)
    const dup = this.items.find((m) => m.userId === userId && m.fact === text)
    if (dup) return dup
    const item: MemoryItem = { id: `mem_${++this.seq}`, userId, fact: text, createdAt: now() }
    this.items.push(item)
    return item
  }

  /** Score this user's memories by keyword overlap and return the k most relevant (skip unrelated ones) */
  recall(userId: string, query: string, k = 3): MemoryItem[] {
    const q = new Set(tokenize(query))
    return this.items
      .filter((m) => m.userId === userId)
      .map((m) => {
        const t = new Set(tokenize(m.fact))
        let hit = 0
        for (const w of q) if (t.has(w)) hit++
        return { m, score: hit / Math.sqrt(t.size || 1) }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
      .slice(0, k)
      .map((x) => x.m)
  }

  all(userId: string): MemoryItem[] {
    return this.items.filter((m) => m.userId === userId)
  }
}

export function createMemoryTools(store: MemoryStore, userId: string): Tool[] {
  return [
    {
      spec: {
        name: 'save_memory',
        description:
          "Save a lasting preference or fact about the user to long-term memory, e.g. delivery/visit times, household details, how they use their devices. Only save what future conversations will need. Never save passwords, card numbers, ID numbers or other sensitive information.",
        input_schema: {
          type: 'object',
          properties: { fact: { type: 'string', description: 'One fact to remember, as a full sentence, e.g. "Visits only after 8 pm"' } },
          required: ['fact'],
        },
      },
      run: (input) => {
        const item = store.remember(userId, String(input.fact ?? ''))
        return `Saved: ${item.fact}`
      },
    },
    {
      spec: {
        name: 'search_memory',
        description: "Search the current user's long-term memory for preferences and facts saved earlier. Use it when the user says \"I told you before\" or you need personal details.",
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search keywords, e.g. "visit time"' } },
          required: ['query'],
        },
      },
      run: (input) => {
        const hits = store.recall(userId, String(input.query ?? ''), 5)
        return hits.length ? hits.map((m) => m.fact) : 'No matching memories'
      },
    },
  ]
}

export function buildSystemWithMemories(base: string, memories: MemoryItem[]): string {
  if (!memories.length) return base
  const list = memories.map((m) => `- ${m.fact}`).join('\n')
  return `${base}\n\n<user_memories>\n${list}\n</user_memories>\nThese are things this user told you before. Use them when you answer.`
}

export const MEMORY_SYSTEM = `You are the Nova Tech support assistant. Answer in concise, friendly English.
- When the user mentions a lasting preference or fact (delivery times, household, how they use their devices), save it with save_memory.
- Never save passwords, card numbers, ID numbers or other sensitive information.`

/** Start a new session: recall relevant memories into the system prompt, then hand off to the agent loop */
export function chatWithMemory(
  store: MemoryStore,
  userId: string,
  message: string,
  opts: { system?: string; tools?: Tool[]; k?: number } = {},
): Promise<AgentResult> {
  const memories = store.recall(userId, message, opts.k ?? 3)
  const system = buildSystemWithMemories(opts.system ?? MEMORY_SYSTEM, memories)
  return runAgent(message, [...(opts.tools ?? []), ...createMemoryTools(store, userId)], { system })
}
