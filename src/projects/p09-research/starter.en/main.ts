import { chat, textOf } from 'agent-quest'
// Tip: you can reuse code from earlier levels
// import { runAgent } from '../../agent'                     // agent loop (Level 4)
// import type { Tool } from '../../tools'                    // tool interface (Level 3)
// import { research as fanOut } from '../../agents/orchestrator' // orchestrator-worker (Level 14)
// import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails' // untrusted-content tags (Level 17)

/** A search result: title and snippet only, no full text */
export interface SearchHit {
  url: string
  title: string
  /** Snippet (not the full text: key facts are often missing here) */
  snippet: string
  /** Publication date YYYY-MM-DD */
  date: string
  /** official / news / blog / forum */
  sourceType: 'official' | 'news' | 'blog' | 'forum'
  site: string
}

/** Full page text returned by fetch */
export interface WebPage {
  url: string
  title: string
  date: string
  sourceType: 'official' | 'news' | 'blog' | 'forum'
  site: string
  text: string
}

/** The "internet" provided by the environment (raw API). How you wrap it into tools for the model is up to you. */
export interface WebEnv {
  /** Keyword search; returns the top k results (default 5, max 10) */
  search(query: string, k?: number): Promise<SearchHit[]>
  /** Open a page and return its full text; throws if the URL doesn't exist */
  fetch(url: string): Promise<WebPage>
}

export interface ResearchAnswer {
  /** The answer for the client (in English) */
  answer: string
  /** Evidence URLs backing the answer (must be pages you actually opened) */
  sources: string[]
}

/**
 * Entry point for deep research: answer a question that needs looking things up, with evidence URLs.
 * This is a project: there's no TODO list and the architecture is up to you. Read the brief first, then the task list.
 */
export async function research(question: string, web: WebEnv): Promise<ResearchAnswer> {
  // The most naive version: search once, hand the snippets to the model, and cite every search result.
  // No page fetching, no multi-hop, no source vetting — see how many points it gets.
  const hits = await web.search(question, 5)
  const context = hits.map((h) => `${h.title}\n${h.snippet}\n${h.url}`).join('\n\n')
  const res = await chat({ messages: [{ role: 'user', content: `${context}\n\nQuestion: ${question}` }] })
  return { answer: textOf(res.content), sources: hits.map((h) => h.url) }
}
