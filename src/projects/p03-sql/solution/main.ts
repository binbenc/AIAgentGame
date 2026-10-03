import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

export interface Column {
  column: string
  type: string
}

/** 环境提供的数据库操作（原始 API） */
export interface SqlEnv {
  listTables(): Promise<string[]>
  describeTable(name: string): Promise<Column[]>
  dataDictionary(): Promise<string>
  /** 会原样执行任何语句：只读要靠我们自己保证 */
  query(sql: string): Promise<Record<string, unknown>[]>
}

export interface SqlAnswer {
  sql: string
  answer: string
}

/** 给模型看的结果行数上限：结果太长既费 token，模型也读不过来 */
const MAX_ROWS = 50

/** 确定性的只读守卫：只放行单条 SELECT / WITH 查询（先去掉注释和字符串字面量再检查） */
export function checkReadOnly(sql: string): string | null {
  const body = sql
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .replace(/;\s*$/, '')
  if (!body) return 'SQL 为空'
  if (body.includes(';')) return '一次只能执行一条语句'
  if (!/^(select|with)\b/i.test(body)) return '数据库是只读的，只允许 SELECT / WITH 查询'
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex)\b/i.test(body)) return '数据库是只读的，查询里不能包含写操作或 DDL'
  return null
}

/** 表结构 + 数据字典：库很小，整份放进 system prompt（库大了要做 schema linking，只放相关的表） */
const contexts = new WeakMap<SqlEnv, Promise<string>>()
function schemaContext(db: SqlEnv): Promise<string> {
  let hit = contexts.get(db)
  if (!hit) {
    hit = (async () => {
      const tables = await db.listTables()
      const lines = await Promise.all(tables.map(async (t) => `${t}(${(await db.describeTable(t)).map((c) => `${c.column} ${c.type}`).join(', ')})`))
      return `<表结构>\n${lines.join('\n')}\n</表结构>\n\n<数据字典>\n${await db.dataDictionary()}\n</数据字典>`
    })()
    contexts.set(db, hit)
  }
  return hit
}

const SYSTEM = (context: string) => `你是拾光盒子数据团队的 Text-to-SQL 助手。数据库是 SQLite，用 run_sql 执行查询，再根据结果用中文回答业务同事的问题。

规则：
- 数据库只读：只能执行单条 SELECT（或 WITH … SELECT）。问题里要求删除、修改、建表等写操作时一律不执行，在回答里说明你只能查询。
- 严格按 <数据字典> 的口径：金额单位、状态码、测试账号、指标定义、废弃表。相对日期以数据截止日为准，不要用 date('now')。
- 只用 <表结构> 里存在的表和列。SQL 报错时，读懂错误信息，修正后重试。
- 拿到结果后用一两句话回答，说出关键数字（金额用元）；最后附上最终使用的 SQL：\`\`\`sql ... \`\`\`

${context}`

function sqlTool(db: SqlEnv, ok: string[]): Tool {
  return {
    spec: {
      name: 'run_sql',
      description: `在只读的 SQLite 数据库上执行一条 SELECT 查询，返回 JSON：{ rows, rowCount, truncated }（最多 ${MAX_ROWS} 行）。出错时返回错误信息。`,
      input_schema: { type: 'object', properties: { sql: { type: 'string', description: '一条 SELECT / WITH 查询' } }, required: ['sql'] },
    },
    run: async ({ sql }) => {
      const text = String(sql ?? '')
      const problem = checkReadOnly(text)
      if (problem) throw new Error(`${problem}。这条语句没有执行。`)
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
  // 返回的 SQL 也要过守卫：模型写在回答里的 SQL 不一定是真正执行成功的那条
  const claimed = blocks[blocks.length - 1]
  const sql = claimed && !checkReadOnly(claimed) ? claimed : (executed[executed.length - 1] ?? '')
  const answer = res.output.replace(/```sql[\s\S]*?```/gi, '').trim()
  log(`Text-to-SQL：${res.stopReason}，${res.steps} 步，执行了 ${executed.length} 条查询`)
  return { sql, answer }
}
