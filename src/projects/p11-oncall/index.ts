import { rawFiles } from '../../content/types'
import type { ProjectDef } from '../types'
import brief from './brief.md?raw'
import { createOncallEnv, type OncallEnv } from './env/index'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type OncallOutput } from './tasks'

const DIR = 'projects/oncall/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<OncallEnv, OncallOutput> = {
  id: 'p11',
  number: 11,
  tier: 4,
  title: '运维 on-call Agent',
  tagline: '沿着依赖链找根因，拿着证据去审批，只动该动的那一个',
  client: '青橙到家（本地生活平台）SRE 团队',
  prototype: { name: 'ITBench / AIOpsLab', url: 'https://github.com/IBM/ITBench' },
  concepts: ['根因分析', '依赖拓扑', '相关 vs 因果', '人工审批（HITL）', '最小处置', '运维手册', '工具输出压缩', '事后复盘'],
  brief,
  guide,
  entry: `${DIR}respond.ts`,
  contract: `export async function respond(alert: Alert, env: OpsEnv): Promise<{
  rootCause: { service: string; category: string }  // category 取值见需求文档
  summary: string                                     // 事后复盘：影响 / 根因 / 证据 / 处置
}>

interface OpsEnv {
  listServices() · getTopology() · getMetrics(service, metric, windowMin?) · searchLogs(service, query, windowMin?)
  getDeployHistory(service) · getRunbook(topic)
  requestApproval({ action, args, reason })            // 值班主管审批
  rollback(service, version) · restart(service) · scale(service, replicas) · toggleFlag(name, on) · failover(dbCluster)
}`,
  starter: prefix(rawFiles(import.meta.glob('./starter/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/starter/')),
  solution: prefix(rawFiles(import.meta.glob('./solution/**/*.ts', { query: '?raw', import: 'default', eager: true }), '/solution/')),
  createEnv: (task, ctx) => createOncallEnv(task.input, ctx),
  invoke: (mod, _task, env) => mod.respond(env.alert, env.ops),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: 113_000,
  maxCallsPerTask: 30,
}
