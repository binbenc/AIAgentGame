import { chat, textOf } from 'agent-quest'
// Tip: the agent loop and tool interface from the earlier levels are ready to reuse
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface DatasetSummary {
  name: string
  /** Number of data rows (header excluded) */
  rows: number
  description: string
}

/**
 * Raw API provided by the environment. How you wrap it into tools for the model is up to you.
 *
 * Inside the runCode sandbox you can `import { load, raw, datasets } from 'data'`:
 * - load(name) parses the CSV by header into an array of rows; every value is a **raw string** (empty is ''; cleaning is your code's job);
 * - raw(name) returns the CSV text; datasets() returns all dataset names.
 * Code runs synchronously (no top-level await); print results with console.log. On failure, the error message is appended to the output.
 */
export interface AnalysisEnv {
  /** Available datasets: name, row count, description */
  listDatasets(): Promise<DatasetSummary[]>
  /** First n lines of the raw CSV (header included); n defaults to 5, max 50 */
  preview(name: string, n?: number): Promise<string>
  /** Run TS / JS code in the sandbox and return the console output (errors are appended, never thrown) */
  runCode(code: string): Promise<string>
}

export interface AnalysisAnswer {
  /** Final answer: a number for numeric questions (at the requested precision), a string for categorical ones */
  answer: number | string
  /** The complete code that computed this answer (must have been run with runCode) */
  code: string
  /** A short explanation of the method */
  explanation: string
}

/**
 * Data analysis agent entry point: answer the ops team's analysis questions.
 * This is a project: no TODO list, the architecture is up to you. Read the brief first, then the task list.
 */
export async function analyze(question: string, env: AnalysisEnv): Promise<AnalysisAnswer> {
  // The naive version: show the model the first few rows of each dataset and ask for the answer directly.
  // The model only sees 5 rows and can't compute statistics over thousands — see how many points it gets.
  const sets = await env.listDatasets()
  const previews = await Promise.all(sets.map(async (s) => `## ${s.name} (${s.rows} rows): ${s.description}\n${await env.preview(s.name, 5)}`))
  const res = await chat({
    max_tokens: 800,
    messages: [{ role: 'user', content: `Data preview:\n\n${previews.join('\n\n')}\n\nQuestion: ${question}\nAnswer directly.` }],
  })
  const text = textOf(res.content)
  const num = /-?\d+(?:\.\d+)?/.exec(text.replace(/,/g, ''))
  return { answer: num ? Number(num[0]) : text.trim(), code: '', explanation: text }
}
