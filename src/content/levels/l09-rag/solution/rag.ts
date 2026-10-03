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
  const { size, overlap } = opts
  const step = Math.max(1, size - overlap)
  const out: Chunk[] = []
  for (let start = 0; ; start += step) {
    const index = out.length
    out.push({ id: `${doc.id}#${index}`, docId: doc.id, index, text: doc.text.slice(start, start + size) })
    if (start + size >= doc.text.length) break
  }
  return out
}

/** BM25：在 TF-IDF 的基础上考虑词频饱和（k1）和文档长度归一化（b） */
export class BM25Index {
  private docs: { chunk: Chunk; tf: Map<string, number>; len: number }[]
  private df = new Map<string, number>()
  private avgLen: number

  constructor(
    chunks: Chunk[],
    private k1 = 1.2,
    private b = 0.75,
  ) {
    this.docs = chunks.map((c) => {
      const tf = new Map<string, number>()
      const terms = tokenize(c.text)
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      return { chunk: c, tf, len: terms.length }
    })
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / (this.docs.length || 1)
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5))
  }

  search(query: string, k = 3): Hit[] {
    const terms = [...new Set(tokenize(query))]
    return this.docs
      .map((d) => {
        let score = 0
        for (const t of terms) {
          const f = d.tf.get(t)
          if (!f) continue
          score += (this.idf(t) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen))
        }
        return { chunk: d.chunk, score }
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }
}

export function buildIndex(docs: Doc[], opts = { size: 150, overlap: 30 }): BM25Index {
  return new BM25Index(docs.flatMap((d) => chunk(d, opts)))
}

export const NO_ANSWER = '抱歉，帮助中心的资料里没有找到相关信息，建议联系人工客服。'

const RAG_SYSTEM = `你是 Nova 科技帮助中心的问答助手。
- 只根据 <资料> 中的内容回答，不要使用资料以外的知识。
- 每个结论后面用 [文档id#块编号] 标注出处，例如 [faq-warranty#0]。
- 如果资料里没有答案，就直接回答“资料中没有相关信息”，不要编造。`

export async function answerWithCitations(
  question: string,
  index: BM25Index,
  opts: { k?: number; minScore?: number } = {},
): Promise<{ answer: string; citations: string[] }> {
  const hits = index.search(question, opts.k ?? 3)
  // 检索不到像样的资料：直接拒答，连模型都不用调
  if (!hits.length || hits[0].score < (opts.minScore ?? 3)) return { answer: NO_ANSWER, citations: [] }

  const context = hits.map((h) => `[${h.chunk.id}]\n${h.chunk.text}`).join('\n\n')
  const res = await chat({
    system: RAG_SYSTEM,
    max_tokens: 500,
    messages: [{ role: 'user', content: `<资料>\n${context}\n</资料>\n\n问题：${question}` }],
  })
  const text = textOf(res.content)

  // 只承认真正检索到的块；模型编出来的出处要删掉
  const allowed = new Set(hits.map((h) => h.chunk.id))
  const citations: string[] = []
  const answer = text
    .replace(/\s*\[([\w-]+#\d+)\]/g, (m, id: string) => {
      if (!allowed.has(id)) return ''
      if (!citations.includes(id)) citations.push(id)
      return m
    })
    .trim()
  return { answer, citations }
}
