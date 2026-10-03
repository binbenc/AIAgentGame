import { chat, log, textOf } from 'agent-quest'
import { BM25Index, chunk, type Hit } from '../../rag'

export interface HelpDoc {
  id: string
  title: string
  category: string
  updatedAt: string
  text: string
}

export interface HelpAnswer {
  answer: string
  /** Cited chunk ids, e.g. "plan-free#0" */
  citations: string[]
  /** true when the docs don't cover it / the question is off-topic */
  refused: boolean
}

export const REFUSAL = "Sorry, there's no information about that in the docs."
const MIN_SCORE = 4
const TOP_K = 4
// English questions are full of function words that match almost every doc: drop them before searching
const STOPWORDS = new Set('a an the is are was were be been do does did can could will would should i me my you your we our it its to of in on for at by with and or if how what when where which who whose why there this that from about'.split(' '))

const SYSTEM = `You are the Aurora Drive help center assistant. Answer the user's question only from the <docs>.
- Each passage is tagged with its [chunk id] and update date. When passages contradict each other, go with the most recent one and ignore outdated ones.
- Cite the source after every claim with its [chunk id].
- If the docs don't contain the answer, reply only: "${REFUSAL}" Don't make anything up or use knowledge from outside the docs.
- Keep it short.`

// Reuse the index while the doc set doesn't change: pay for indexing only once
const indexes = new WeakMap<HelpDoc[], { index: BM25Index; meta: Map<string, HelpDoc> }>()

function getIndex(docs: HelpDoc[]) {
  let hit = indexes.get(docs)
  if (!hit) {
    // Put the title into the text too: many questions share keywords only with the title
    const chunks = docs.flatMap((d) => chunk({ id: d.id, title: d.title, text: `${d.title}. ${d.text}` }, { size: 600, overlap: 100 }))
    hit = { index: new BM25Index(chunks), meta: new Map(docs.map((d) => [d.id, d])) }
    indexes.set(docs, hit)
  }
  return hit
}

function render(hits: Hit[], meta: Map<string, HelpDoc>): string {
  return hits
    .map((h) => {
      const d = meta.get(h.chunk.docId)!
      return `[${h.chunk.id}] (${d.title}, updated ${d.updatedAt})\n${h.chunk.text}`
    })
    .join('\n\n')
}

export async function answer(question: string, docs: HelpDoc[]): Promise<HelpAnswer> {
  const { index, meta } = getIndex(docs)
  const query = question.split(/[^\w'-]+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase())).join(' ')
  const hits = index.search(query, TOP_K)
  log(`retrieved: ${hits.map((h) => `${h.chunk.id}=${h.score.toFixed(1)}`).join(', ')}`)
  // Retrieval score too low: most likely off-topic, so refuse without even calling the model
  if (!hits.length || hits[0].score < MIN_SCORE) return { answer: REFUSAL, citations: [], refused: true }

  const res = await chat({
    system: SYSTEM,
    max_tokens: 600,
    messages: [{ role: 'user', content: `<docs>\n${render(hits, meta)}\n</docs>\n\nQuestion: ${question}` }],
  })
  const text = textOf(res.content).trim()
  if (text.includes('no information about that')) return { answer: REFUSAL, citations: [], refused: true }

  // Only accept chunks that were actually retrieved; drop any source the model made up
  const allowed = new Set(hits.map((h) => h.chunk.id))
  const citations: string[] = []
  const cleaned = text.replace(/\s*\[([\w-]+#\d+)\]/g, (m, id: string) => {
    if (!allowed.has(id)) return ''
    if (!citations.includes(id)) citations.push(id)
    return m
  })
  return { answer: cleaned, citations, refused: false }
}
