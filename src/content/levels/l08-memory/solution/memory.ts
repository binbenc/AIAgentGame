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
 * 简单的中英文分词：英文/数字按单词，中文按“字二元组”（bigram）。
 * 例如 “上门安装” → ['上门', '门安', '安装']。返回值保留重复，方便以后算词频。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const [run] of text.toLowerCase().matchAll(/[a-z0-9]+|[一-鿿]+/g)) {
    if (/^[a-z0-9]/.test(run) || run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

/** 检查是否包含不该进入长期记忆的敏感信息；有就返回原因 */
export function containsSecret(text: string): string | null {
  if (/\d(?:[\s-]?\d){12,18}/.test(text)) return '疑似银行卡号或身份证号'
  if (/密码|口令|password|passwd|cvv|验证码/i.test(text)) return '密码或验证码'
  return null
}

export class MemoryStore {
  private items: MemoryItem[] = []
  private seq = 0

  remember(userId: string, fact: string): MemoryItem {
    const text = fact.trim()
    const reason = containsSecret(text)
    if (reason) throw new Error(`拒绝保存：内容包含敏感信息（${reason}）。不要把密码、银行卡号、证件号写进长期记忆。`)
    const dup = this.items.find((m) => m.userId === userId && m.fact === text)
    if (dup) return dup
    const item: MemoryItem = { id: `mem_${++this.seq}`, userId, fact: text, createdAt: now() }
    this.items.push(item)
    return item
  }

  /** 按关键词重合度给该用户的记忆打分，返回最相关的 k 条（不相关的不返回） */
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
          '把用户长期有效的偏好或事实保存到长期记忆，例如收货/上门时间、家庭情况、设备使用习惯。只保存以后的对话还用得上的信息；严禁保存密码、银行卡号、身份证号等敏感信息。',
        input_schema: {
          type: 'object',
          properties: { fact: { type: 'string', description: '要记住的一条事实，用一句完整的话描述，例如“只能晚上 8 点以后上门”' } },
          required: ['fact'],
        },
      },
      run: (input) => {
        const item = store.remember(userId, String(input.fact ?? ''))
        return `已记住：${item.fact}`
      },
    },
    {
      spec: {
        name: 'search_memory',
        description: '在当前用户的长期记忆里搜索之前保存过的偏好和事实。用户提到“我之前说过”或需要个性化信息时使用。',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索关键词，例如“上门时间”' } },
          required: ['query'],
        },
      },
      run: (input) => {
        const hits = store.recall(userId, String(input.query ?? ''), 5)
        return hits.length ? hits.map((m) => m.fact) : '没有找到相关记忆'
      },
    },
  ]
}

export function buildSystemWithMemories(base: string, memories: MemoryItem[]): string {
  if (!memories.length) return base
  const list = memories.map((m) => `- ${m.fact}`).join('\n')
  return `${base}\n\n<用户记忆>\n${list}\n</用户记忆>\n以上是该用户之前告诉过你的信息，回答时要主动参考。`
}

export const MEMORY_SYSTEM = `你是 Nova 科技的客服助手，用简洁友好的中文回答。
- 用户提到长期有效的偏好或事实（收货时间、家庭情况、设备习惯等）时，用 save_memory 记下来。
- 不要保存密码、银行卡号、身份证号等敏感信息。`

/** 开启一个新会话：先召回相关记忆注入 system，再交给 Agent 循环 */
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
