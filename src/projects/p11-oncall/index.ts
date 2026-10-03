import { localizedFiles, rawFiles } from '../../content/types'
import { L } from '../../engine/locale'
import type { ProjectDef } from '../types'
import briefEn from './brief.en.md?raw'
import brief from './brief.md?raw'
import { createOncallEnv, type OncallEnv } from './env/index'
import guideEn from './guide.en.md?raw'
import guide from './guide.md?raw'
import { mock } from './mock'
import { toTasks, type OncallOutput } from './tasks'

const DIR = 'projects/oncall/'
const prefix = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [DIR + k, v]))

export const project: ProjectDef<OncallEnv, OncallOutput> = {
  id: 'p11',
  number: 11,
  tier: 4,
  title: L('运维 on-call Agent', 'On-call Ops Agent'),
  tagline: L('沿着依赖链找根因，拿着证据去审批，只动该动的那一个', 'Follow the dependency chain to the root cause, bring evidence to the approver, touch only what needs fixing'),
  client: L('青橙到家（本地生活平台）SRE 团队', 'Qingcheng Home (local-services platform) SRE team'),
  prototype: { name: 'ITBench / AIOpsLab', url: 'https://github.com/IBM/ITBench' },
  concepts: L(
    ['根因分析', '依赖拓扑', '相关 vs 因果', '人工审批（HITL）', '最小处置', '运维手册', '工具输出压缩', '事后复盘'],
    ['Root-cause analysis', 'Dependency topology', 'Correlation vs causation', 'Human approval (HITL)', 'Minimal remediation', 'Runbooks', 'Compressing tool output', 'Postmortems'],
  ),
  brief: L(brief, briefEn),
  guide: L(guide, guideEn),
  entry: `${DIR}respond.ts`,
  contract: L(
    `export async function respond(alert: Alert, env: OpsEnv): Promise<{
  rootCause: { service: string; category: string }  // category 取值见需求文档
  summary: string                                     // 事后复盘：影响 / 根因 / 证据 / 处置
}>

interface OpsEnv {
  listServices() · getTopology() · getMetrics(service, metric, windowMin?) · searchLogs(service, query, windowMin?)
  getDeployHistory(service) · getRunbook(topic)
  requestApproval({ action, args, reason })            // 值班主管审批
  rollback(service, version) · restart(service) · scale(service, replicas) · toggleFlag(name, on) · failover(dbCluster)
}`,
    `export async function respond(alert: Alert, env: OpsEnv): Promise<{
  rootCause: { service: string; category: string }  // category values: see the brief
  summary: string                                     // postmortem: Impact / Root cause / Evidence / Remediation
}>

interface OpsEnv {
  listServices() · getTopology() · getMetrics(service, metric, windowMin?) · searchLogs(service, query, windowMin?)
  getDeployHistory(service) · getRunbook(topic)
  requestApproval({ action, args, reason })            // approval by the on-call lead
  rollback(service, version) · restart(service) · scale(service, replicas) · toggleFlag(name, on) · failover(dbCluster)
}`,
  ),
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
  createEnv: (task, ctx) => createOncallEnv(task.input, ctx),
  invoke: (mod, _task, env) => mod.respond(env.alert, env.ops),
  tasks: toTasks(),
  mock,
  passThreshold: 0.75,
  tokenBudget: L(113_000, 98_000),
  maxCallsPerTask: 30,
}
