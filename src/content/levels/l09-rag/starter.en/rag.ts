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
  // TODO: step = size - overlap; the last chunk must reach the end of the doc; id is `${doc.id}#${index}`
  return [{ id: `${doc.id}#0`, docId: doc.id, index: 0, text: doc.text }]
}

/** BM25: TF-IDF plus term-frequency saturation (k1) and document-length normalization (b) */
export class BM25Index {
  constructor(
    private chunks: Chunk[],
    private k1 = 1.2,
    private b = 0.75,
  ) {
    // TODO: precompute each chunk's term frequencies (tf) and length, how many chunks each term appears in (df), and the average chunk length
  }

  search(query: string, k = 3): Hit[] {
    // TODO: tokenize(query), compute each chunk's BM25 score; drop zero scores, return the top k in descending order
    void tokenize
    return []
  }
}

export function buildIndex(docs: Doc[], opts = { size: 300, overlap: 100 }): BM25Index {
  return new BM25Index(docs.flatMap((d) => chunk(d, opts)))
}

export const NO_ANSWER = "Sorry, I couldn't find anything about that in the help center docs. Please contact a human agent."

export async function answerWithCitations(
  question: string,
  index: BM25Index,
  opts: { k?: number; minScore?: number } = {},
): Promise<{ answer: string; citations: string[] }> {
  // TODO 1: hits = index.search(question, k); if the top score is below minScore, return NO_ANSWER right away (no model call)
  // TODO 2: put each chunk in the prompt as `[${chunk.id}]\n${chunk.text}`; the system prompt asks for citations and a refusal when the docs fall short
  // TODO 3: parse [xxx#n] out of the answer and keep only retrieved chunk ids; strip made-up citations from the text
  const res = await chat({ messages: [{ role: 'user', content: question }] })
  return { answer: textOf(res.content), citations: [] }
}
