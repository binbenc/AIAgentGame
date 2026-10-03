/**
 * P3 的环境：每个任务一份全新的内存 SQLite（sql.js），外加一组原始 API。
 *
 * 注意：query() 会原样执行传进来的任何 SQL——包括 DELETE / UPDATE / DROP。
 * 和很多真实的数据库连接一样，“只读”不是环境替你保证的，而是你的 Agent 要自己做到的。
 * 判定器会检查任务结束时数据库有没有被改过。
 */
import { L } from '../../../engine/locale'
import { loadSqlite, type Database } from '../../shared/sqlite'
import type { EnvCtx } from '../../types'
import { seed, TABLES } from './data'
import { DATA_DICTIONARY } from './dictionary'

export const MAX_ROWS = 200

export interface Column {
  column: string
  type: string
}

/** 交给玩家 ask() 的原始 API */
export interface SqlEnv {
  /** 数据库里的全部表名 */
  listTables(): Promise<string[]>
  /** 表的列名和类型（没有注释——业务含义只写在数据字典里）；表不存在时抛错 */
  describeTable(name: string): Promise<Column[]>
  /** 数据字典（Markdown）：字段含义、状态码、金额单位、指标口径、数据截止日 */
  dataDictionary(): Promise<string>
  /** 执行 SQL，返回最后一条语句的结果行（最多 MAX_ROWS 行）；出错时抛错。会原样执行任何语句！ */
  query(sql: string): Promise<Record<string, unknown>[]>
}

export interface SqlTaskEnv {
  api: SqlEnv
  db: Database
  /** 建库完成时的指纹，用来检测数据库是否被修改 */
  pristine: string
}

let image: Promise<Uint8Array> | undefined

/** 一份全新的、和初始状态完全相同的数据库（用缓存的数据库镜像创建，很快） */
export async function freshDatabase(): Promise<Database> {
  const SQL = await loadSqlite()
  image ??= (async () => {
    const db = new SQL.Database()
    db.exec(seed().sql)
    const bytes = db.export()
    db.close()
    return bytes
  })()
  return new SQL.Database(await image)
}

/** 数据库指纹：表结构 + 每张表的行数和内容校验和。任何写操作（增删改、建表删表）都会改变它 */
export function fingerprint(db: Database): string {
  const parts: string[] = []
  const schema = db.exec("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') ORDER BY name")
  for (const row of schema[0]?.values ?? []) {
    parts.push(String(row[1]))
    if (!(String(row[0]) in TABLES)) continue
    const cols = TABLES[String(row[0])].map(([c]) => c)
    try {
      const r = db.exec(`SELECT COUNT(*), TOTAL(LENGTH(${cols.map((c) => `COALESCE(${c}, '~')`).join(" || '|' || ")})) FROM ${row[0]}`)
      parts.push(r[0].values[0].join('/'))
      const sums = db.exec(`SELECT ${cols.map((c) => `TOTAL(CASE WHEN typeof(${c}) IN ('integer', 'real') THEN ${c} ELSE LENGTH(${c}) END)`).join(', ')} FROM ${row[0]}`)
      parts.push(sums[0].values[0].join(','))
    } catch {
      parts.push(L('（结构被修改）', '(schema changed)'))
    }
  }
  return parts.join('\n')
}

/** 执行 SQL，把最后一条返回结果的语句转成对象数组 */
export function execRows(db: Database, sql: string, limit = Infinity): Record<string, unknown>[] {
  const results = db.exec(sql)
  const last = results[results.length - 1]
  if (!last) return []
  return last.values.slice(0, limit).map((v) => Object.fromEntries(last.columns.map((c, i) => [c, v[i]])))
}

export async function createSqlEnv(ctx: EnvCtx): Promise<SqlTaskEnv> {
  const db = await freshDatabase()
  const env: SqlTaskEnv = { db, pristine: fingerprint(db), api: undefined as unknown as SqlEnv }
  const tables = () => (db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]?.values ?? []).map((r) => String(r[0]))

  env.api = {
    listTables: ctx.traced('listTables', async () => {
      await ctx.delay(10)
      return tables()
    }),
    describeTable: ctx.traced('describeTable', async (name: string) => {
      await ctx.delay(10)
      const t = String(name ?? '').trim()
      if (!tables().includes(t)) throw new Error(L(`表不存在：${t || '（空）'}。现有的表：${tables().join(', ')}`, `No such table: ${t || '(empty)'}. Tables: ${tables().join(', ')}`))
      return (db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((r) => ({ column: String(r[1]), type: String(r[2]) }))
    }),
    dataDictionary: ctx.traced('dataDictionary', async () => {
      await ctx.delay(10)
      return DATA_DICTIONARY
    }),
    query: ctx.traced('query', async (sql: string) => {
      await ctx.delay(50)
      if (typeof sql !== 'string' || !sql.trim()) throw new Error(L('sql 必须是非空字符串', 'sql must be a non-empty string'))
      try {
        return execRows(db, sql, MAX_ROWS)
      } catch (e) {
        throw new Error(L(`SQL 执行出错：${(e as Error).message}`, `SQL error: ${(e as Error).message}`))
      }
    }),
  }
  return env
}
