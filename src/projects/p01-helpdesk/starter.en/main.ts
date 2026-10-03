import { chat, textOf } from 'agent-quest'
// Hint: you can reuse the retrieval code you wrote in level 9
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
  /** Cited chunk ids or doc ids, e.g. "plan-free#0" */
  citations: string[]
  /** true when the docs don't cover it / the question is off-topic */
  refused: boolean
}

/**
 * Entry point of the help center Q&A. docs holds every help center article (about 40); every call gets the same array.
 * This is a project: there is no TODO list, the architecture is up to you. Read the brief first, then the task list.
 */
export async function answer(question: string, docs: HelpDoc[]): Promise<HelpAnswer> {
  // The most naive version: stuff every doc into the prompt. It runs, but it's expensive and inaccurate. See how many stars it gets.
  const context = docs.map((d) => `${d.title}: ${d.text}`).join('\n')
  const res = await chat({ messages: [{ role: 'user', content: `${context}\n\nQuestion: ${question}` }] })
  return { answer: textOf(res.content), citations: [], refused: false }
}
