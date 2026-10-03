/**
 * 浏览器 / Node 通用的 SQLite（sql.js，WebAssembly）。按需加载，只初始化一次。
 * 用法：const db = await openDatabase(schemaAndSeedSql); db.exec('SELECT ...')
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

let ready: Promise<SqlJsStatic> | undefined

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as { window?: unknown }).window === 'undefined' && typeof (globalThis as { importScripts?: unknown }).importScripts === 'undefined'

export function loadSqlite(): Promise<SqlJsStatic> {
  ready ??= (async () => {
    if (isNode) return initSqlJs()
    const { default: url } = await import('sql.js/dist/sql-wasm.wasm?url')
    // 转成绝对地址：在 blob / 子路径部署的 Worker 里相对路径会失效
    return initSqlJs({ locateFile: () => new URL(url, import.meta.url).href })
  })()
  return ready
}

export async function openDatabase(sql?: string): Promise<Database> {
  const SQL = await loadSqlite()
  const db = new SQL.Database()
  if (sql) db.exec(sql)
  return db
}

export type { Database }

/** 把 db.exec 的结果转成对象数组 */
export function rowsOf(db: Database, sql: string, params?: (string | number | null)[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  try {
    if (params) stmt.bind(params)
    const out: Record<string, unknown>[] = []
    while (stmt.step()) out.push(stmt.getAsObject())
    return out
  } finally {
    stmt.free()
  }
}
