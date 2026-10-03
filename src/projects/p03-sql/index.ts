import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import briefEn from './brief.en.md?raw'
import { createSqlEnv, type SqlTaskEnv } from './env/index'
import guide from './guide.md?raw'
import guideEn from './guide.en.md?raw'
import { mock } from './mock'
import { toTasks, type SqlAnswer } from './tasks'

const DIR = 'projects/sql/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<SqlTaskEnv, SqlAnswer> = {
  id: 'p03',
  number: 3,
  tier: 2,
  title: L('Text-to-SQL 数据助手', 'Text-to-SQL Data Assistant'),
  tagline: L('读懂表结构和数据字典，写对口径、只读不写——执行结果说了算', 'Read the schema and the data dictionary, get the metric definitions right, never write — the execution result is the judge'),
  client: L('拾光盒子（订阅制生活方式电商）数据团队', 'Data team at Glimmer Box (subscription lifestyle e-commerce)'),
  prototype: { name: 'Spider / BIRD', url: 'https://bird-bench.github.io/' },
  concepts: L(['Schema 上下文', '数据字典 / 业务口径', '执行准确率', '只读守卫', '报错自修复'], ['Schema context', 'Data dictionary / metric definitions', 'Execution accuracy', 'Read-only guard', 'Self-repair on errors']),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}main.ts`,
  contract: `export async function ask(question: string, db: SqlEnv): Promise<{ sql: string; answer: string }>

interface SqlEnv {
  listTables(): Promise<string[]>
  describeTable(name: string): Promise<{ column: string; type: string }[]>
  dataDictionary(): Promise<string>                      // ${L('口径、状态码、单位、数据截止日', 'metric definitions, status codes, units, data cutoff date')}
  query(sql: string): Promise<Record<string, unknown>[]> // ${L('最多 200 行；会原样执行任何语句！', 'at most 200 rows; runs ANY statement as-is!')}
}`,
  starter: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/'),
      rawFiles(import.meta.glob('./starter.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter.en/'),
    ),
  ),
  solution: prefix(
    localizedFiles(
      rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/'),
      rawFiles(import.meta.glob('./solution.en/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution.en/'),
    ),
  ),
  createEnv: (_task, ctx) => createSqlEnv(ctx),
  invoke: (mod, task, env) => mod.ask(task.input, env.api),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(32_000, 27_000),
  maxCallsPerTask: 20,
}
