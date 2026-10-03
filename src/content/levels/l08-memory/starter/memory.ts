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
  // TODO：转小写 → 用 /[a-z0-9]+|[一-鿿]+/g 切出连续片段
  //       英文/数字片段整体作为一个词；中文片段拆成相邻两个字一组（只有 1 个字就保留单字）
  return []
}

/** 检查是否包含不该进入长期记忆的敏感信息；有就返回原因 */
export function containsSecret(text: string): string | null {
  // TODO：银行卡号/身份证号（13~19 位数字，中间可能有空格或横线）、密码、验证码……
  return null
}

export class MemoryStore {
  private items: MemoryItem[] = []
  private seq = 0

  remember(userId: string, fact: string): MemoryItem {
    // TODO：敏感信息直接抛错拒绝；同一用户的相同事实不要重复保存
    const item: MemoryItem = { id: `mem_${++this.seq}`, userId, fact, createdAt: now() }
    this.items.push(item)
    return item
  }

  /** 按关键词重合度给该用户的记忆打分，返回最相关的 k 条（不相关的不返回） */
  recall(userId: string, query: string, k = 3): MemoryItem[] {
    // TODO：只看该用户的记忆；用 tokenize 算 query 和 fact 的重合度，过滤 0 分，降序取前 k 条
    return []
  }

  all(userId: string): MemoryItem[] {
    return this.items.filter((m) => m.userId === userId)
  }
}

export function createMemoryTools(store: MemoryStore, userId: string): Tool[] {
  // TODO：返回两个工具
  //   save_memory(fact)：保存长期偏好；description 写清“什么该存、什么严禁存”
  //   search_memory(query)：搜索该用户的记忆
  return []
}

export function buildSystemWithMemories(base: string, memories: MemoryItem[]): string {
  // TODO：把记忆列表拼进 system，例如在 base 后面加一段 <用户记忆> ... </用户记忆>
  return base
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
  // TODO：recall 相关记忆 → buildSystemWithMemories → runAgent 时带上 createMemoryTools
  return runAgent(message, opts.tools ?? [], { system: opts.system ?? MEMORY_SYSTEM })
}
