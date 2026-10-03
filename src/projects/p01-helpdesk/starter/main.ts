import { chat, textOf } from 'agent-quest'
// 提示：第 9 关写过的检索代码可以直接复用
// import { BM25Index, chunk } from '../../rag'

export interface HelpDoc {
  id: string
  title: string
  category: string
  updatedAt: string
  text: string
}

export interface HelpAnswer {
  answer: string
  /** 引用的块 id 或文档 id，例如 "plan-free#0" */
  citations: string[]
  /** 资料不足 / 超出范围时为 true */
  refused: boolean
}

/**
 * 帮助中心问答的入口。docs 是帮助中心的全部文档（约 40 篇），每次调用传入的是同一个数组。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function answer(question: string, docs: HelpDoc[]): Promise<HelpAnswer> {
  // 最朴素的版本：把全部文档塞给模型。能跑，但又贵又不准——试试看它能拿几分。
  const context = docs.map((d) => `${d.title}：${d.text}`).join('\n')
  const res = await chat({ messages: [{ role: 'user', content: `${context}\n\n问题：${question}` }] })
  return { answer: textOf(res.content), citations: [], refused: false }
}
