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
  // TODO: lowercase → split into runs with /[a-z0-9]+|[一-鿿]+/g
  //       an English/number run is one token; a Chinese run becomes overlapping pairs of characters (a single character stays as is)
  return []
}

/** Check for sensitive data that must never go into long-term memory; return the reason if found */
export function containsSecret(text: string): string | null {
  // TODO: card / ID numbers (13–19 digits, possibly separated by spaces or dashes), passwords, verification codes…
  return null
}

export class MemoryStore {
  private items: MemoryItem[] = []
  private seq = 0

  remember(userId: string, fact: string): MemoryItem {
    // TODO: throw to refuse sensitive data; don't save the same fact twice for the same user
    const item: MemoryItem = { id: `mem_${++this.seq}`, userId, fact, createdAt: now() }
    this.items.push(item)
    return item
  }

  /** Score this user's memories by keyword overlap and return the k most relevant (skip unrelated ones) */
  recall(userId: string, query: string, k = 3): MemoryItem[] {
    // TODO: only this user's memories; score query/fact overlap with tokenize, drop zero scores, return the top k in descending order
    return []
  }

  all(userId: string): MemoryItem[] {
    return this.items.filter((m) => m.userId === userId)
  }
}

export function createMemoryTools(store: MemoryStore, userId: string): Tool[] {
  // TODO: return two tools
  //   save_memory(fact): save a lasting preference; the description must say what to save and what must never be saved
  //   search_memory(query): search this user's memories
  return []
}

export function buildSystemWithMemories(base: string, memories: MemoryItem[]): string {
  // TODO: append the memories to the system prompt, e.g. a <user_memories> ... </user_memories> block after base
  return base
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
  // TODO: recall relevant memories → buildSystemWithMemories → runAgent with createMemoryTools included
  return runAgent(message, opts.tools ?? [], { system: opts.system ?? MEMORY_SYSTEM })
}
