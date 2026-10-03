import { chat, textOf } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
// 提示：前面关卡写好的 Agent 循环、工具接口、人工审批都可以复用
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface Alert {
  id: string
  /** 触发告警的服务（不一定是根因） */
  service: string
  title: string
  severity: 'P1' | 'P2' | 'P3'
  firedAt: string
  description: string
}

export type RemediationAction = 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'

/** 环境提供的运维 API（原始接口）。怎么包装成给模型用的工具，由你决定。 */
export interface OpsEnv {
  /** 所有服务 / 组件（含 ext-* 外部依赖）：类型、负责人、副本数、当前版本、节点池 */
  listServices(): Promise<{ name: string; kind: string; description: string; owner: string; replicas?: number; version?: string; nodePool?: string }[]>
  /** 依赖拓扑：from 调用 to */
  getTopology(): Promise<{ edges: { from: string; to: string }[] }>
  /** 指标时间序列（每分钟一个点，最早的在前）；windowMin 默认 30，最大 60 */
  getMetrics(service: string, metric: string, windowMin?: number): Promise<{ service: string; metric: string; unit: string; points: { t: string; v: number }[] }>
  /** 日志搜索（关键词大小写不敏感，空格分隔的词全部匹配）；返回最新的 20 条 */
  searchLogs(service: string, query: string, windowMin?: number): Promise<{ service: string; query: string; total: number; lines: string[] }>
  /** 变更历史（发布、配置、开关、扩缩容、证书），新的在前 */
  getDeployHistory(service: string): Promise<{ time: string; type: string; version?: string; summary: string; author: string }[]>
  /** 运维手册（按主题模糊匹配） */
  getRunbook(topic: string): Promise<string>
  /** 申请处置审批：值班主管只看 reason 里的证据 */
  requestApproval(req: { action: RemediationAction; args: Record<string, unknown>; reason: string }): Promise<{ approved: boolean; approver: string; comment: string }>
  // —— 处置（API 不会拦你，但流程要求每个处置之前都有一条对应的、已批准的审批）——
  rollback(service: string, version: string): Promise<string>
  restart(service: string): Promise<string>
  scale(service: string, replicas: number): Promise<string>
  toggleFlag(name: string, on: boolean): Promise<string>
  failover(dbCluster: string): Promise<string>
}

export interface Diagnosis {
  rootCause: { service: string; category: string }
  summary: string
}

/**
 * on-call Agent 的入口：收到一条告警，排查根因、（审批后）处置、写复盘。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function respond(alert: Alert, env: OpsEnv): Promise<Diagnosis> {
  // 最朴素的版本：只看告警服务自己的错误率和日志，让模型一次性给出结论。
  // 不查拓扑、不看变更、不做处置——试试看它能对几道。
  const [errors, logs] = await Promise.all([env.getMetrics(alert.service, 'error_rate', 30), env.searchLogs(alert.service, 'error', 30)])
  const res = await chat({
    messages: [
      {
        role: 'user',
        content: `告警：${JSON.stringify(alert)}\n错误率：${JSON.stringify(errors.points)}\n日志：${logs.lines.join('\n')}\n\n根因是什么？用 JSON 回答：{"rootCause":{"service":"...","category":"..."},"summary":"..."}`,
      },
    ],
  })
  try {
    return parseJsonLoose(textOf(res.content)) as Diagnosis
  } catch {
    return { rootCause: { service: alert.service, category: 'bad_deploy' }, summary: textOf(res.content) }
  }
}
