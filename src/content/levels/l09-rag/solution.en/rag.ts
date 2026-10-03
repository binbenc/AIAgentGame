import { chat, textOf } from 'agent-quest'
import { tokenize } from './memory'

export interface Doc {
  id: string
  title: string
  text: string
}

export interface Chunk {
  /** Like "l2-manual#1": doc id + chunk number, used for citations */
  id: string
  docId: string
  index: number
  text: string
}

export interface Hit {
  chunk: Chunk
  score: number
}

/** Fixed-size sliding window: neighboring chunks overlap by `overlap` characters so answers don't get cut in half */
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

/** BM25: TF-IDF plus term-frequency saturation (k1) and document-length normalization (b) */
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

export function buildIndex(docs: Doc[], opts = { size: 300, overlap: 100 }): BM25Index {
  return new BM25Index(docs.flatMap((d) => chunk(d, opts)))
}

export const NO_ANSWER = "Sorry, I couldn't find anything about that in the help center docs. Please contact a human agent."

const RAG_SYSTEM = `You answer questions for the Nova Tech help center.
- Answer only from the <docs> below. Don't use any outside knowledge.
- After each claim, cite its source as [doc-id#chunk], e.g. [faq-warranty#0].
- If the docs don't contain the answer, just say "The docs don't have that information." Don't make anything up.`

export async function answerWithCitations(
  question: string,
  index: BM25Index,
  opts: { k?: number; minScore?: number } = {},
): Promise<{ answer: string; citations: string[] }> {
  const hits = index.search(question, opts.k ?? 3)
  // Nothing relevant retrieved: refuse right away, no need to call the model at all
  if (!hits.length || hits[0].score < (opts.minScore ?? 3)) return { answer: NO_ANSWER, citations: [] }

  const context = hits.map((h) => `[${h.chunk.id}]\n${h.chunk.text}`).join('\n\n')
  const res = await chat({
    system: RAG_SYSTEM,
    max_tokens: 500,
    messages: [{ role: 'user', content: `<docs>\n${context}\n</docs>\n\nQuestion: ${question}` }],
  })
  const text = textOf(res.content)

  // Only accept chunks we actually retrieved; strip citations the model made up
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
