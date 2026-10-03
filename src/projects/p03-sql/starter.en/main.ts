import { chat, textOf } from 'agent-quest'
// Tip: the agent loop and tool interface you built in the levels are ready to reuse
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface Column {
  column: string
  type: string
}

/** Database operations provided by the environment (raw API). How you wrap them as tools and what you show the model is up to you. */
export interface SqlEnv {
  /** All table names in the database */
  listTables(): Promise<string[]>
  /** A table's column names and types (no comments — business meaning lives only in the data dictionary) */
  describeTable(name: string): Promise<Column[]>
  /** Data dictionary (Markdown): column meanings, status codes, money units, metric definitions, data cutoff date */
  dataDictionary(): Promise<string>
  /** Runs SQL and returns the rows (at most 200); throws on error. Careful: it runs ANY statement as-is, including DELETE / DROP! */
  query(sql: string): Promise<Record<string, unknown>[]>
}

export interface SqlAnswer {
  /** The SQL you finally used to answer the question (the grader re-runs it) */
  sql: string
  /** The answer for the business user; must state the key numbers */
  answer: string
}

/**
 * Entry point of the Text-to-SQL data assistant: turn a colleague's question into SQL, run it, and answer in plain English.
 * This is a project: there's no TODO list and the architecture is yours. Read the brief first, then look at the task list.
 */
export async function ask(question: string, db: SqlEnv): Promise<SqlAnswer> {
  // The most naive version: hand the model only the question, let it guess the SQL, run it once and call it done.
  // The model doesn't know the tables, what the columns mean, or how metrics are defined — see how many points it gets.
  const res = await chat({
    max_tokens: 1000,
    messages: [{ role: 'user', content: `Write the following question as a single SQLite query. Output only the SQL.\n\nQuestion: ${question}` }],
  })
  const text = textOf(res.content)
  const sql = (/```(?:sql)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text).trim()
  try {
    const rows = await db.query(sql)
    return { sql, answer: `Query result: ${JSON.stringify(rows.slice(0, 10))}` }
  } catch (e) {
    return { sql, answer: `Query failed: ${(e as Error).message}` }
  }
}
