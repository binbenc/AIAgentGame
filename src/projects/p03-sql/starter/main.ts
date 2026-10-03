import { chat, textOf } from 'agent-quest'
// 提示：前面关卡写好的 Agent 循环和工具接口可以直接复用
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface Column {
  column: string
  type: string
}

/** 环境提供的数据库操作（原始 API）。怎么包装成给模型用的工具、给模型看什么，由你决定。 */
export interface SqlEnv {
  /** 数据库里的全部表名 */
  listTables(): Promise<string[]>
  /** 表的列名和类型（没有注释——业务含义只写在数据字典里） */
  describeTable(name: string): Promise<Column[]>
  /** 数据字典（Markdown）：字段含义、状态码、金额单位、指标口径、数据截止日 */
  dataDictionary(): Promise<string>
  /** 执行 SQL，返回结果行（最多 200 行），出错时抛错。注意：它会原样执行任何语句，包括 DELETE / DROP！ */
  query(sql: string): Promise<Record<string, unknown>[]>
}

export interface SqlAnswer {
  /** 最终用来回答问题的那条 SQL（判定器会重新执行它） */
  sql: string
  /** 给业务方看的回答，要说出关键数字 */
  answer: string
}

/**
 * Text-to-SQL 数据助手的入口：把业务同事的自然语言问题变成 SQL，执行，再用中文回答。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function ask(question: string, db: SqlEnv): Promise<SqlAnswer> {
  // 最朴素的版本：只把问题交给模型，让它“凭感觉”写 SQL，执行一次就交差。
  // 模型不知道有哪些表、字段是什么意思、口径怎么算——试试看它能拿几分。
  const res = await chat({
    max_tokens: 1000,
    messages: [{ role: 'user', content: `请把下面的问题写成一条 SQLite 查询，只输出 SQL。\n\n问题：${question}` }],
  })
  const text = textOf(res.content)
  const sql = (/```(?:sql)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text).trim()
  try {
    const rows = await db.query(sql)
    return { sql, answer: `查询结果：${JSON.stringify(rows.slice(0, 10))}` }
  } catch (e) {
    return { sql, answer: `查询失败：${(e as Error).message}` }
  }
}
