import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createSqlEnv, type SqlTaskEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type SqlAnswer } from './tasks'

const DIR = 'projects/sql/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<SqlTaskEnv, SqlAnswer> = {
  id: 'p03',
  number: 3,
  tier: 2,
  title: 'Text-to-SQL 数据助手',
  tagline: '读懂表结构和数据字典，写对口径、只读不写——执行结果说了算',
  client: '拾光盒子（订阅制生活方式电商）数据团队',
  prototype: { name: 'Spider / BIRD', url: 'https://bird-bench.github.io/' },
  concepts: ['Schema 上下文', '数据字典 / 业务口径', '执行准确率', '只读守卫', '报错自修复'],
  brief,
  guide,
  entry: `${DIR}main.ts`,
  contract: `export async function ask(question: string, db: SqlEnv): Promise<{ sql: string; answer: string }>

interface SqlEnv {
  listTables(): Promise<string[]>
  describeTable(name: string): Promise<{ column: string; type: string }[]>
  dataDictionary(): Promise<string>                      // 口径、状态码、单位、数据截止日
  query(sql: string): Promise<Record<string, unknown>[]> // 最多 200 行；会原样执行任何语句！
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (_task, ctx) => createSqlEnv(ctx),
  invoke: (mod, task, env) => mod.ask(task.input, env.api),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 32_000,
  maxCallsPerTask: 20,
}
