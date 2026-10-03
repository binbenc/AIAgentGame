import { chat, textOf } from 'agent-quest'
import { tokenize } from './memory'

export interface Doc {
  id: string
  title: string
  text: string
}

export interface Chunk {
  /** 形如 "l2-manual#1"：文档 id + 块编号，用来标注出处 */
  id: string
  docId: string
  index: number
  text: string
}

export interface Hit {
  chunk: Chunk
  score: number
}

/** 定长滑动窗口切块：相邻两块重叠 overlap 个字符，避免答案被切断 */
export function chunk(doc: Doc, opts: { size: number; overlap: number }): Chunk[] {
  // TODO：步长 = size - overlap；最后一块要覆盖到文档末尾；id 为 `${doc.id}#${index}`
  return [{ id: `${doc.id}#0`, docId: doc.id, index: 0, text: doc.text }]
}

/** BM25：在 TF-IDF 的基础上考虑词频饱和（k1）和文档长度归一化（b） */
export class BM25Index {
  constructor(
    private chunks: Chunk[],
    private k1 = 1.2,
    private b = 0.75,
  ) {
    // TODO：预先统计每块的词频（tf）、块长度、每个词出现在多少块里（df）、平均块长度
  }

  search(query: string, k = 3): Hit[] {
    // TODO：用 tokenize(query) 切词，对每块算 BM25 分数；过滤 0 分，降序取前 k 条
    void tokenize
    return []
  }
}

export function buildIndex(docs: Doc[], opts = { size: 150, overlap: 30 }): BM25Index {
  return new BM25Index(docs.flatMap((d) => chunk(d, opts)))
}

export const NO_ANSWER = '抱歉，帮助中心的资料里没有找到相关信息，建议联系人工客服。'

export async function answerWithCitations(
  question: string,
  index: BM25Index,
  opts: { k?: number; minScore?: number } = {},
): Promise<{ answer: string; citations: string[] }> {
  // TODO 1：hits = index.search(question, k)；最高分低于 minScore 就直接返回 NO_ANSWER（不调用模型）
  // TODO 2：把每块写成 `[${chunk.id}]\n${chunk.text}` 放进 prompt；system 要求标注出处、资料不足时拒答
  // TODO 3：解析回答里的 [xxx#n]，只保留检索到的块 id；编造的出处从正文里删掉
  const res = await chat({ messages: [{ role: 'user', content: question }] })
  return { answer: textOf(res.content), citations: [] }
}
