import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

export interface Column {
  column: string
  type: string
}

/** Database operations provided by the environment (raw API) */
export interface SqlEnv {
  listTables(): Promise<string[]>
  describeTable(name: string): Promise<Column[]>
  dataDictionary(): Promise<string>
  /** Runs any statement as-is: read-only is our job */
  query(sql: string): Promise<Record<string, unknown>[]>
}

export interface SqlAnswer {
  sql: string
  answer: string
}

/** Max rows shown to the model: long results cost tokens and the model can't read them anyway */
const MAX_ROWS = 50

/** Deterministic read-only guard: allow a single SELECT / WITH query only (strip comments and string literals first) */
export function checkReadOnly(sql: string): string | null {
  const body = sql
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;\s*$/, '')
  if (!body) return 'Empty SQL'
  if (body.includes(';')) return 'Only one statement at a time'
  if (!/^(select|with)\b/i.test(body)) return 'The database is read-only: only SELECT / WITH queries are allowed'
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i.test(body)) return 'The database is read-only: the query must not contain writes or DDL'
  return null
}

/** Schema + data dictionary: the database is small, so it all goes in the system prompt (a big one needs schema linking: only the relevant tables) */
const contexts = new WeakMap<SqlEnv, Promise<string>>()
function schemaContext(db: SqlEnv): Promise<string> {
  let hit = contexts.get(db)
  if (!hit) {
    hit = (async () => {
      const tables = await db.listTables()
      const lines = await Promise.all(tables.map(async (t) => `${t}(${(await db.describeTable(t)).map((c) => `${c.column} ${c.type}`).join(', ')})`))
      return `<schema>\n${lines.join('\n')}\n</schema>\n\n<data_dictionary>\n${await db.dataDictionary()}\n</data_dictionary>`
    })()
    contexts.set(db, hit)
  }
  return hit
}

const SYSTEM = (context: string) => `You are the Text-to-SQL assistant for the Glimmer Box data team. The database is SQLite: run queries with run_sql, then answer the colleague's question from the results.

Rules:
- The database is read-only: run a single SELECT (or WITH … SELECT) only. If the question asks to delete, modify or create anything, don't do it — say in your answer that you can only query.
- Follow the definitions in <data_dictionary> exactly: money units, status codes, test accounts, metric definitions, deprecated tables. Relative dates are based on the data cutoff date; never use date('now').
- Use only tables and columns that exist in <schema>. If the SQL fails, read the error, fix the query and retry.
- Answer in one or two sentences with the key numbers (money in yuan), then append the final SQL you used: \`\`\`sql ... \`\`\`

${context}`

function sqlTool(db: SqlEnv, ok: string[]): Tool {
  return {
    spec: {
      name: 'run_sql',
      description: `Run one SELECT query on the read-only SQLite database. Returns JSON: { rows, rowCount, truncated } (at most ${MAX_ROWS} rows), or the error message.`,
      input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'One SELECT / WITH query' } }, required: ['sql'] },
    },
    run: async ({ sql }) => {
      const text = String(sql ?? '')
      const problem = checkReadOnly(text)
      if (problem) throw new Error(`${problem}. The statement was not executed.`)
      const rows = await db.query(text)
      ok.push(text)
      return { rows: rows.slice(0, MAX_ROWS), rowCount: rows.length, truncated: rows.length > MAX_ROWS }
    },
  }
}

export async function ask(question: string, db: SqlEnv): Promise<SqlAnswer> {
  const executed: string[] = []
  const res = await runAgent(question, [sqlTool(db, executed)], { system: SYSTEM(await schemaContext(db)), maxSteps: 8 })
  const blocks = [...res.output.matchAll(/```sql\s*([\s\S]*?)```/gi)].map((m) => m[1].trim())
  // The returned SQL goes through the guard too: the SQL the model writes in its answer isn't necessarily the one that ran
  const claimed = blocks[blocks.length - 1]
  const sql = claimed && !checkReadOnly(claimed) ? claimed : (executed[executed.length - 1] ?? '')
  const answer = res.output.replace(/```sql[\s\S]*?```/gi, '').trim()
  log(`Text-to-SQL: ${res.stopReason}, ${res.steps} steps, ${executed.length} queries run`)
  return { sql, answer }
}
