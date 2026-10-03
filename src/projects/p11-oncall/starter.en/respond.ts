import { chat, textOf } from 'agent-quest'
import { parseJsonLoose } from '../../structured'
// Tip: the agent loop, tool interface and human approval you built in earlier levels are all reusable
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

export interface Alert {
  id: string
  /** The service that fired the alert (not necessarily the root cause) */
  service: string
  title: string
  severity: 'P1' | 'P2' | 'P3'
  firedAt: string
  description: string
}

export type RemediationAction = 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'

/** The raw ops API provided by the environment. How you wrap it into tools for the model is up to you. */
export interface OpsEnv {
  /** All services / components (including ext-* dependencies): kind, owner, replicas, current version, node pool */
  listServices(): Promise<{ name: string; kind: string; description: string; owner: string; replicas?: number; version?: string; nodePool?: string }[]>
  /** Dependency topology: from calls to */
  getTopology(): Promise<{ edges: { from: string; to: string }[] }>
  /** Metric time series (one point per minute, oldest first); windowMin defaults to 30, max 60 */
  getMetrics(service: string, metric: string, windowMin?: number): Promise<{ service: string; metric: string; unit: string; points: { t: string; v: number }[] }>
  /** Log search (case-insensitive, space-separated keywords must all match); returns the latest 20 lines */
  searchLogs(service: string, query: string, windowMin?: number): Promise<{ service: string; query: string; total: number; lines: string[] }>
  /** Change history (deploys, config, flags, scaling, certs), newest first */
  getDeployHistory(service: string): Promise<{ time: string; type: string; version?: string; summary: string; author: string }[]>
  /** Runbooks (fuzzy match on topic) */
  getRunbook(topic: string): Promise<string>
  /** Request approval for a remediation: the on-call lead only looks at the evidence in reason */
  requestApproval(req: { action: RemediationAction; args: Record<string, unknown>; reason: string }): Promise<{ approved: boolean; approver: string; comment: string }>
  // —— Remediation (the API won't stop you, but the process requires a matching approved request before each one) ——
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
 * Entry point of the on-call agent: take an alert, find the root cause, remediate (after approval), write a postmortem.
 * This is a "project": no TODO list, the architecture is yours. Read the brief first, then look at the task list.
 */
export async function respond(alert: Alert, env: OpsEnv): Promise<Diagnosis> {
  // The most naive version: look only at the alerting service's own error rate and logs and ask the model for a verdict in one shot.
  // No topology, no change history, no remediation — see how many it gets right.
  const [errors, logs] = await Promise.all([env.getMetrics(alert.service, 'error_rate', 30), env.searchLogs(alert.service, 'error', 30)])
  const res = await chat({
    messages: [
      {
        role: 'user',
        content: `Alert: ${JSON.stringify(alert)}\nError rate: ${JSON.stringify(errors.points)}\nLogs: ${logs.lines.join('\n')}\n\nWhat's the root cause? Answer in JSON: {"rootCause":{"service":"...","category":"..."},"summary":"..."}`,
      },
    ],
  })
  try {
    return parseJsonLoose(textOf(res.content)) as Diagnosis
  } catch {
    return { rootCause: { service: alert.service, category: 'bad_deploy' }, summary: textOf(res.content) }
  }
}
