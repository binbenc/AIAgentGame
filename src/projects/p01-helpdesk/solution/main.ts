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
  /** 引用的块 id，例如 "plan-free#0" */
  citations: string[]
  /** 资料不足 / 超出范围时为 true */
  refused: boolean
}

export const REFUSAL = '抱歉，资料中没有相关信息。'
const MIN_SCORE = 4
const TOP_K = 4

const SYSTEM = `你是极光网盘的帮助中心助手，只根据 <资料> 回答用户的问题。
- 每条资料都标了 [块id] 和更新日期。多条资料互相矛盾时，以更新日期最新的为准，忽略过时的资料。
- 每个结论后面用 [块id] 标注出处。
- 资料里没有答案时，只回答：“${REFUSAL}”，不要编造，也不要使用资料以外的知识。
- 回答简洁，用中文。`

// 文档集合不变时复用索引：建索引的成本只付一次
const indexes = new WeakMap<HelpDoc[], { index: BM25Index; meta: Map<string, HelpDoc> }>()

function getIndex(docs: HelpDoc[]) {
  let hit = indexes.get(docs)
  if (!hit) {
    // 标题也放进正文：很多问题的关键词只出现在标题里
    const chunks = docs.flatMap((d) => chunk({ id: d.id, title: d.title, text: `${d.title}。${d.text}` }, { size: 200, overlap: 40 }))
    hit = { index: new BM25Index(chunks), meta: new Map(docs.map((d) => [d.id, d])) }
    indexes.set(docs, hit)
  }
  return hit
}

function render(hits: Hit[], meta: Map<string, HelpDoc>): string {
  return hits
    .map((h) => {
      const d = meta.get(h.chunk.docId)!
      return `[${h.chunk.id}]（${d.title}，更新日期 ${d.updatedAt}）\n${h.chunk.text}`
    })
    .join('\n\n')
}

export async function answer(question: string, docs: HelpDoc[]): Promise<HelpAnswer> {
  const { index, meta } = getIndex(docs)
  const hits = index.search(question, TOP_K)
  log(`检索：${hits.map((h) => `${h.chunk.id}=${h.score.toFixed(1)}`).join(', ')}`)
  // 检索得分太低：大概率与产品无关，直接拒答，连模型都不用调
  if (!hits.length || hits[0].score < MIN_SCORE) return { answer: REFUSAL, citations: [], refused: true }

  const res = await chat({
    system: SYSTEM,
    max_tokens: 600,
    messages: [{ role: 'user', content: `<资料>\n${render(hits, meta)}\n</资料>\n\n问题：${question}` }],
  })
  const text = textOf(res.content).trim()
  if (text.includes('没有相关信息')) return { answer: REFUSAL, citations: [], refused: true }

  // 只承认真正检索到的块，模型编出来的出处一律删掉
  const allowed = new Set(hits.map((h) => h.chunk.id))
  const citations: string[] = []
  const cleaned = text.replace(/\s*\[([\w-]+#\d+)\]/g, (m, id: string) => {
    if (!allowed.has(id)) return ''
    if (!citations.includes(id)) citations.push(id)
    return m
  })
  return { answer: cleaned, citations, refused: false }
}
