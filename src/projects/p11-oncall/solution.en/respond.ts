import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import { parseJsonLoose } from '../../structured'
import type { Tool } from '../../tools'

export interface Alert {
  id: string
  service: string
  title: string
  severity: 'P1' | 'P2' | 'P3'
  firedAt: string
  description: string
}

export type RemediationAction = 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'

/** The raw ops API provided by the environment */
export interface OpsEnv {
  listServices(): Promise<{ name: string; kind: string; description: string; owner: string; replicas?: number; version?: string; nodePool?: string }[]>
  getTopology(): Promise<{ edges: { from: string; to: string }[] }>
  getMetrics(service: string, metric: string, windowMin?: number): Promise<{ service: string; metric: string; unit: string; points: { t: string; v: number }[] }>
  searchLogs(service: string, query: string, windowMin?: number): Promise<{ service: string; query: string; total: number; lines: string[] }>
  getDeployHistory(service: string): Promise<{ time: string; type: string; version?: string; summary: string; author: string }[]>
  getRunbook(topic: string): Promise<string>
  requestApproval(req: { action: RemediationAction; args: Record<string, unknown>; reason: string }): Promise<{ approved: boolean; approver: string; comment: string }>
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

export const CATEGORIES = [
  'bad_deploy',
  'config_error',
  'db_connection_exhaustion',
  'cache_eviction',
  'cert_expiry',
  'noisy_neighbor',
  'disk_full',
  'capacity',
  'instance_failure',
  'third_party_outage',
  'false_alarm',
]

const SYSTEM = `You are the SRE on-call agent for Qingcheng Home. For each alert: find the root cause, apply the minimal remediation after approval, and write a postmortem.

Process:
1. First confirm the alert is still firing: check the alerting service's relevant metrics and error logs over the last 60 minutes. If only one or two points crossed the threshold, it has since recovered and no new error logs appeared (or it's just client 4xx / load-test traffic), it's a false alarm (flapping): don't make any changes.
2. Use get_topology to walk the dependency chain: an alerting service is often dragged down by a downstream dependency. Check each hop's error rate / latency and error logs until you find the service that is failing on its own, not because of someone else. Check callers too — an upstream retry storm can also overwhelm a downstream service.
3. Check the suspect's change history (deploys, config, flags, scaling, certs). A change must happen before the anomaly started; a change made after the onset is not the cause.
4. Use get_runbook to find the matching runbook and follow its steps in order.
5. Keep remediation minimal: only fix the root cause; don't restart or roll back services that are merely affected. Never fail over unless the primary instance is actually unreachable.
6. Every remediation tool requests approval first. The approval reason must include evidence: the root-cause service, the metric values or log lines that support it, and why this action fixes it. If an approval is rejected, add evidence or stop — don't force a different action.
7. Third-party (ext-*) outage: make no changes on our side; escalate to the vendor and put a status update in the summary.
8. After remediating, check the metrics again to confirm recovery.

Finally output only one JSON object and nothing else:
{"rootCause": {"service": "...", "category": "..."}, "summary": "..."}
- service must be a name from list_services (including ext-* dependencies); for a false alarm use the alerting service itself.
- category must be one of: ${CATEGORIES.join(' / ')}.
- summary is a short postmortem with four sections: Impact, Root cause, Evidence, Remediation. Evidence must cite specific metric values, log lines, versions or flag names.`

// —————————— Tool output: compact text that's easy for the model to read and cheap in tokens ——————————

/** Metric series → one summary line + a sample every 5 minutes: enough to see the trend and when the anomaly started */
export function summarizeSeries(s: { service: string; metric: string; unit: string; points: { t: string; v: number }[] }): string {
  const vs = s.points.map((p) => p.v)
  if (!vs.length) return `${s.service} ${s.metric}: no data`
  const head = [...vs.slice(0, Math.max(3, Math.floor(vs.length / 4)))].sort((a, b) => a - b)
  const base = head[Math.floor(head.length / 2)]
  const maxV = Math.max(...vs)
  const maxAt = s.points[vs.indexOf(maxV)].t
  const off = (v: number) => Math.abs(v - base) > Math.max(base * 0.5, s.unit === '%' ? 2 : 1)
  const start = s.points.find((p) => off(p.v))
  const abnormal = vs.filter(off).length
  const samples = s.points.filter((_, i) => i % 5 === 0 || i === s.points.length - 1).map((p) => `${p.t} ${p.v}`)
  return `${s.service} ${s.metric} (${s.unit}): baseline≈${base}, max ${maxV} (${maxAt}), now ${vs[vs.length - 1]}; ${
    start ? `off baseline since ${start.t}, abnormal ${abnormal}/${vs.length} min` : 'near baseline throughout'
  }\nsamples: ${samples.join(' | ')}`
}

/** Logs → strip timestamps and ids, merge by content, add count and first / last time */
export function summarizeLogs(r: { service: string; query: string; total: number; lines: string[] }): string {
  if (!r.total) return `${r.service}: no logs match "${r.query}"`
  const groups = new Map<string, { n: number; first: string; last: string }>()
  for (const line of r.lines) {
    const time = line.slice(0, 8)
    const key = line.slice(9).replace(/\b[A-Z]?\d{4,}\b/g, '#')
    const g = groups.get(key)
    if (g) {
      g.n++
      g.first = time
    } else groups.set(key, { n: 1, first: time, last: time })
  }
  const rows = [...groups].map(([k, g]) => `${g.first}~${g.last} ×${g.n} ${k}`)
  return `${r.service}: ${r.total} log lines match "${r.query}" (latest ${r.lines.length}, merged):\n${rows.join('\n')}`
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required }) as Tool['spec']['input_schema']
const S = (description: string) => ({ type: 'string', description })
const REASON = S('Approval reason: root-cause service + the metric values or log lines that support it + why this action fixes it')

export function createOpsTools(env: OpsEnv): Tool[] {
  /** Remediation tool: request approval first, execute only if approved (the gate lives in code, not in the model's goodwill) */
  const gated = (action: RemediationAction, argsOf: (i: any) => Record<string, unknown>, run: (i: any) => Promise<string>) => async (input: any) => {
    const args = argsOf(input)
    const decision = await env.requestApproval({ action, args, reason: String(input.reason ?? '') })
    log(`[approval] ${action} ${JSON.stringify(args)}: ${decision.approved ? 'approved' : decision.comment}`)
    if (!decision.approved) throw new Error(`Approval rejected (${decision.approver}): ${decision.comment}`)
    return `${await run(input)}. Approver: ${decision.approver} (${decision.comment})`
  }
  return [
    { spec: { name: 'list_services', description: 'List all services / components (including ext-* dependencies): kind, owner, replicas, current version, node pool.', input_schema: obj({}, []) }, run: () => env.listServices() },
    {
      spec: { name: 'get_topology', description: 'Service dependency topology, one "caller → callee" per line.', input_schema: obj({}, []) },
      run: async () => (await env.getTopology()).edges.map((e) => `${e.from} → ${e.to}`).join('\n'),
    },
    {
      spec: {
        name: 'get_metrics',
        description: 'Get one metric for a service (summary + a sample every 5 minutes). Services: latency_p99 / error_rate / cpu / mem / rps / connections / disk; redis: evictions / hit_rate etc.; mysql: connections etc.',
        input_schema: obj({ service: S('Service name'), metric: S('Metric name, e.g. error_rate'), window_min: { type: 'integer', description: 'Time window in minutes (max 60)' } }, ['service', 'metric']),
      },
      run: async (i) => summarizeSeries(await env.getMetrics(String(i.service), String(i.metric), Number(i.window_min ?? 60))),
    },
    {
      spec: {
        name: 'search_logs',
        description: 'Search a service\'s recent logs (case-insensitive keywords, space-separated, all must match; empty string returns everything). Identical lines are merged with a count.',
        input_schema: obj({ service: S('Service name'), query: S('Keywords, e.g. "error"'), window_min: { type: 'integer', description: 'Time window in minutes (max 60)' } }, ['service', 'query']),
      },
      run: async (i) => summarizeLogs(await env.searchLogs(String(i.service), String(i.query ?? ''), Number(i.window_min ?? 60))),
    },
    {
      spec: { name: 'get_deploy_history', description: 'Recent changes to a service (deploys, config, feature flags, scaling, certs), newest first.', input_schema: obj({ service: S('Service name') }, ['service']) },
      run: async (i) => (await env.getDeployHistory(String(i.service))).map((c) => `${c.time} [${c.type}] ${c.version ?? ''} ${c.summary} (${c.author})`).join('\n'),
    },
    { spec: { name: 'get_runbook', description: 'Look up a runbook by topic, e.g. "disk full", "certificate expiry", "DB connection exhaustion", "third-party outage".', input_schema: obj({ topic: S('Topic keywords') }, ['topic']) }, run: (i) => env.getRunbook(String(i.topic)) },
    {
      spec: { name: 'rollback', description: 'Roll a service (or component config) back to a version from its change history. Requests approval first.', input_schema: obj({ service: S('Service name'), version: S('Target version, e.g. v5.7.3 or cfg-41'), reason: REASON }, ['service', 'version', 'reason']) },
      run: gated('rollback', (i) => ({ service: i.service, version: i.version }), (i) => env.rollback(String(i.service), String(i.version))),
    },
    {
      spec: { name: 'restart', description: 'Rolling restart of a service. Requests approval first.', input_schema: obj({ service: S('Service name'), reason: REASON }, ['service', 'reason']) },
      run: gated('restart', (i) => ({ service: i.service }), (i) => env.restart(String(i.service))),
    },
    {
      spec: { name: 'scale', description: 'Change a service\'s replica count. Requests approval first.', input_schema: obj({ service: S('Service name'), replicas: { type: 'integer', description: 'Target replica count' }, reason: REASON }, ['service', 'replicas', 'reason']) },
      run: gated('scale', (i) => ({ service: i.service, replicas: Number(i.replicas) }), (i) => env.scale(String(i.service), Number(i.replicas))),
    },
    {
      spec: { name: 'toggle_flag', description: 'Turn a feature flag on / off. Requests approval first.', input_schema: obj({ name: S('Flag name'), on: { type: 'boolean', description: 'true = on, false = off' }, reason: REASON }, ['name', 'on', 'reason']) },
      run: gated('toggleFlag', (i) => ({ name: i.name, on: i.on === true || i.on === 'true' }), (i) => env.toggleFlag(String(i.name), i.on === true || i.on === 'true')),
    },
    {
      spec: { name: 'failover', description: 'Database primary → replica failover (high risk: ~30 s of write downtime). Only when the primary instance is unreachable. Requests approval first.', input_schema: obj({ cluster: S('Database cluster name'), reason: REASON }, ['cluster', 'reason']) },
      run: gated('failover', (i) => ({ cluster: i.cluster }), (i) => env.failover(String(i.cluster))),
    },
  ]
}

function parseDiagnosis(text: string, alert: Alert): Diagnosis {
  try {
    const d = parseJsonLoose(text) as Partial<Diagnosis>
    if (d?.rootCause?.service && d.rootCause.category && typeof d.summary === 'string')
      return { rootCause: { service: String(d.rootCause.service).trim(), category: String(d.rootCause.category).trim() }, summary: d.summary }
  } catch {
    /* fall through to the fallback */
  }
  log(`Couldn't parse the diagnosis, using a fallback: ${text.slice(0, 100)}`)
  return { rootCause: { service: alert.service, category: 'false_alarm' }, summary: `Impact: unknown. Root cause: not determined. Evidence: none. Remediation: no changes made; needs a human to investigate. Raw output: ${text.slice(0, 200)}` }
}

export async function respond(alert: Alert, env: OpsEnv): Promise<Diagnosis> {
  const task = `Alert received:\n${JSON.stringify(alert, null, 2)}\n\nInvestigate, remediate per the process, and output the JSON.`
  const res = await runAgent(task, createOpsTools(env), { system: SYSTEM, maxSteps: 25 })
  log(`on-call agent finished: ${res.stopReason}, ${res.steps} steps`)
  return parseDiagnosis(res.output, alert)
}
