/**
 * P11 的环境：一套注入了故障的模拟微服务系统 + 交给玩家的运维 API（OpsEnv）+ 模拟的值班主管（审批人）。
 *
 * - 读接口（拓扑、指标、日志、变更、手册）随便调。
 * - 处置接口（rollback / restart / scale / toggleFlag / failover）**API 本身不拦**——和真实的运维平台一样，
 *   有权限就能执行；但流程要求每个处置先通过 requestApproval 拿到值班主管的批准。判定器会检查每个处置之前
 *   是否有一条对应的、已批准的审批。
 * - 值班主管只看审批理由：理由里要写清楚根因服务和支撑的指标 / 日志证据；故障切换、重启数据库这类高风险操作要更强的证据。
 * - 处置会真的改变系统：命中根因的处置让系统恢复（之后的指标回落、错误日志消失），没命中的不会。
 */
import { L } from '../../../engine/locale'
import type { EnvCtx } from '../../types'
import { clock, INCIDENTS, type Alert, type Applied, type Incident } from './incidents'
import { BASE_CHANGES, BASE_FLAGS, BASELINE, EDGES, METRICS_BY_KIND, RUNBOOKS, SERVICES, UNITS, type Change, type Flag, type Metric, type ServiceInfo } from './system'

export type { Alert } from './incidents'

export interface MetricSeries {
  service: string
  metric: Metric
  unit: string
  /** 每分钟一个点，最早的在前 */
  points: { t: string; v: number }[]
}

export interface LogResult {
  service: string
  query: string
  /** 匹配的总条数 */
  total: number
  /** 最新的在前，最多 20 条 */
  lines: string[]
}

export type RemediationAction = 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'

export interface ApprovalRequest {
  action: RemediationAction
  args: Record<string, unknown>
  reason: string
}

export interface ApprovalDecision {
  approved: boolean
  approver: string
  comment: string
}

/** 交给玩家 respond() 的运维 API */
export interface OpsEnv {
  listServices(): Promise<ServiceInfo[]>
  getTopology(): Promise<{ edges: { from: string; to: string }[] }>
  getMetrics(service: string, metric: string, windowMin?: number): Promise<MetricSeries>
  searchLogs(service: string, query: string, windowMin?: number): Promise<LogResult>
  getDeployHistory(service: string): Promise<Change[]>
  getRunbook(topic: string): Promise<string>
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>
  rollback(service: string, version: string): Promise<string>
  restart(service: string): Promise<string>
  scale(service: string, replicas: number): Promise<string>
  toggleFlag(name: string, on: boolean): Promise<string>
  failover(dbCluster: string): Promise<string>
}

export interface ApprovalRecord extends ApprovalRequest {
  target: string
  decision: ApprovalDecision
  used: boolean
}

export interface ActionRecord extends Applied {
  /** 执行前是否拿到了对应的、已批准的审批 */
  approved: boolean
}

export interface OncallEnv {
  ops: OpsEnv
  alert: Alert
  incident: Incident
  approvals: ApprovalRecord[]
  actions: ActionRecord[]
  /** 系统最终是否恢复（不需要处置的事故：没做任何处置即为 true） */
  healthy(): boolean
}

const NOW = 60
const fail = (msg: string): never => {
  throw new Error(msg)
}

function noise(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 2001) / 1000 - 1 // [-1, 1]
}
const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10)

const APPROVER = L('阿强（SRE 值班主管）', 'Qiang (SRE on-call lead)')
const SIGNAL = /错误率|error[_ ]?rate|5xx|4xx|50[0-9]|p99|延迟|latency|连接|connection|cpu|内存|mem|oom|磁盘|disk|no space|日志|log|报错|异常|exception|版本|发布|deploy|v\d+\.\d+|cfg-\d+|证书|x509|cert|超时|timeout|驱逐|evict|命中率|hit_rate|rps|流量|副本|replica|开关|flag|心跳|heartbeat|不可达|unreachable/i

export function createOncallEnv(incidentId: string, ctx: EnvCtx): OncallEnv {
  const inc = INCIDENTS.find((i) => i.id === incidentId) ?? fail(L(`未知事故：${incidentId}`, `Unknown incident: ${incidentId}`))
  let now = NOW
  let recoveredAt: number | undefined
  const approvals: ApprovalRecord[] = []
  const actions: ActionRecord[] = []
  const services = new Map(SERVICES.map((s) => [s.name, { ...s }]))
  const changes: Record<string, Change[]> = {}
  for (const s of SERVICES) changes[s.name] = [...(inc.changes?.[s.name] ?? []), ...(BASE_CHANGES[s.name] ?? [])]
  for (const s of services.values()) {
    if (s.kind === 'external') continue
    s.version = inc.versions?.[s.name] ?? changes[s.name].find((c) => c.version && (c.type === 'deploy' || s.kind !== 'service'))?.version
    s.replicas = inc.replicas?.[s.name] ?? s.replicas
  }
  const flags: Flag[] = BASE_FLAGS.map((f) => ({ ...f, on: inc.flags?.[f.name] ?? f.on }))

  const svc = (name: unknown) => {
    const n = String(name ?? '').trim()
    return services.get(n) ?? fail(L(`服务 ${n || '（空）'} 不存在。可用的服务：${[...services.keys()].join('、')}`, `Service ${n || '(empty)'} doesn't exist. Available services: ${[...services.keys()].join(', ')}`))
  }
  const active = (from: number, end: number, idx: number) => idx >= from && idx <= end && (recoveredAt === undefined || idx < recoveredAt + 2)

  function value(service: string, metric: Metric, idx: number): number {
    const base = BASELINE[service]?.[metric] ?? 0
    let v = base + (metric === 'error_rate' ? 0.1 * noise(`${service}${metric}${idx}`) : base * 0.05 * noise(`${service}${metric}${idx}`))
    for (const e of inc.effects) {
      if (e.service !== service || e.metric !== metric) continue
      const end = e.shape === 'spike' ? (e.until ?? e.from) : Infinity
      if (!active(e.from, end, idx)) continue
      if (e.shape === 'ramp' && e.rampTo !== undefined && idx < e.rampTo) v = base + ((e.value - base) * (idx - e.from + 1)) / (e.rampTo - e.from + 1)
      else v = e.value * (1 + 0.02 * noise(`${service}${metric}${idx}e`))
    }
    if (metric === 'error_rate' || metric === 'cpu' || metric === 'mem' || metric === 'disk' || metric === 'hit_rate') v = Math.min(100, v)
    if (metric === 'connections' && service === 'mysql-orders') v = Math.min(500, v)
    return Math.max(0, round(v))
  }

  function logLines(service: string, from: number, to: number): { idx: number; line: string }[] {
    const out: { idx: number; line: string }[] = []
    const stamp = (idx: number, salt: string) => `${clock(idx)}:${String(Math.floor((noise(`${service}${idx}${salt}`) + 1) * 29.5)).padStart(2, '0')}`
    for (let idx = from; idx <= to; idx++) {
      if (idx % 4 === 0) out.push({ idx, line: `${stamp(idx, 'i')} INFO [${service}] health check ok, ${services.get(service)?.replicas ?? 1} replicas ready` })
      if (idx % 7 === 3 && services.get(service)?.kind === 'service') out.push({ idx, line: `${stamp(idx, 'w')} WARN [${service}] slow request 1${String(idx).padStart(3, '0')}ms GET /internal/metrics` })
      for (const r of inc.logs) {
        if (r.service !== service || !active(r.from, r.until ?? Infinity, idx) || (idx - r.from) % r.every !== 0) continue
        out.push({ idx, line: `${stamp(idx, r.text)} ${r.level} [${service}] ${r.text.replace('{n}', String(10000 + ((idx * 7919) % 90000)))}` })
      }
    }
    return out
  }

  const windowOf = (w: unknown) => {
    const n = w === undefined || w === null || w === '' ? 30 : Number(w)
    if (!Number.isFinite(n) || n < 1) fail(L(`windowMin 必须是 1~60 的数字，收到：${JSON.stringify(w)}`, `windowMin must be a number from 1 to 60, got: ${JSON.stringify(w)}`))
    return Math.min(60, Math.round(n))
  }

  const traced = <A extends unknown[], R>(name: string, ms: number, fn: (...a: A) => R) =>
    ctx.traced(name, async (...a: A) => {
      await ctx.delay(ms)
      return fn(...a)
    })

  // —————————— 审批 ——————————
  const targetOf = (args: Record<string, unknown>) => String(args.service ?? args.cluster ?? args.dbCluster ?? args.name ?? args.flag ?? '').trim()
  const ACTIONS: RemediationAction[] = ['rollback', 'restart', 'scale', 'toggleFlag', 'failover']
  const normAction = (a: unknown): RemediationAction | undefined => {
    const s = String(a ?? '').replace(/[_\s-]/g, '').toLowerCase()
    return ACTIONS.find((x) => x.toLowerCase() === s)
  }

  function decide(req: ApprovalRequest): ApprovalDecision {
    const action = normAction(req.action)
    const args = (req.args ?? {}) as Record<string, unknown>
    const target = targetOf(args)
    const reason = String(req.reason ?? '').trim()
    const no = (comment: string): ApprovalDecision => ({ approved: false, approver: APPROVER, comment: L(`驳回：${comment}`, `Rejected: ${comment}`) })
    if (!action) return no(L(`不认识的处置动作 ${JSON.stringify(req.action)}，可选：${ACTIONS.join(' / ')}`, `unknown action ${JSON.stringify(req.action)}; options: ${ACTIONS.join(' / ')}`))
    if (!target) return no(L('args 里没有写处置对象（service / cluster / name）', 'args has no target (service / cluster / name)'))
    const flag = flags.find((f) => f.name === target)
    if (action === 'toggleFlag' ? !flag : !services.has(target)) return no(L(`${target} 不存在`, `${target} doesn't exist`))
    if (reason.length < 15) return no(L('理由太短。请写清楚：根因是哪个服务、哪个指标或日志支持这个判断、为什么这个操作能解决问题。', 'reason is too short. Spell out which service is the root cause, which metric or log supports that, and why this action fixes it.'))
    const mentions = reason.includes(target) || (!!flag && reason.includes(flag.owner))
    if (!mentions || !SIGNAL.test(reason))
      return no(
        L(
          `理由里没有证据。请写明根因服务（${target}）和支撑判断的指标或日志，例如“payment-svc 在 09:52 发布 v5.8.0 后 error_rate 升到 35%，日志大量 NullPointerException”。`,
          `no evidence in the reason. Name the root-cause service (${target}) and the metric or log that supports it, e.g. "after payment-svc deployed v5.8.0 at 09:52, error_rate rose to 35% and logs are full of NullPointerException".`,
        ),
      )
    const kind = services.get(target)?.kind
    if (action === 'failover' && !(/主库|primary/i.test(reason) && /不可达|unreachable|心跳|heartbeat|宕机|down|挂了/i.test(reason)))
      return no(L('故障切换会造成写中断，只有主库实例本身不可用（不可达 / 心跳丢失）时才能切。请附上主库不可达的证据。', 'a failover means write downtime; only fail over when the primary instance itself is down (unreachable / heartbeat lost). Include evidence that the primary is unreachable.'))
    if (action === 'restart' && (kind === 'database' || kind === 'cache') && !L(/oom|无响应|hang|卡死|进程/i, /oom|无响应|hang|卡死|进程|unresponsive|crash|process/i).test(reason))
      return no(L(`重启 ${target} 会清空连接 / 缓存，风险很高。没有实例本身故障（OOM、进程无响应）的证据，不批准。`, `restarting ${target} drops all connections / the whole cache, which is high risk. Not approved without evidence that the instance itself is broken (OOM, unresponsive process).`))
    if (action === 'scale' && Number(args.replicas) === 0 && kind === 'service' && !/批处理|batch|报表|report/i.test(reason)) return no(L('缩容到 0 等于下线服务，不批准。', 'scaling to 0 takes the service offline; not approved.'))
    return { approved: true, approver: APPROVER, comment: L('批准：理由和证据清楚，执行吧。执行后盯 5 分钟指标。', 'Approved: reasoning and evidence are clear, go ahead. Watch the metrics for 5 minutes afterwards.') }
  }

  function remediate(action: RemediationAction, args: Record<string, unknown>, apply: () => string): string {
    const target = targetOf(args)
    const key = action === 'rollback' ? 'version' : action === 'scale' ? 'replicas' : action === 'toggleFlag' ? 'on' : undefined
    const approval = approvals.find(
      (a) => !a.used && a.decision.approved && normAction(a.action) === action && a.target === target && (!key || a.args[key] === undefined || String(a.args[key]) === String(args[key])),
    )
    const out = apply()
    if (approval) approval.used = true
    const rec: ActionRecord = { action, target, at: now, approved: !!approval }
    if (action === 'rollback') rec.version = String(args.version)
    if (action === 'scale') rec.replicas = Number(args.replicas)
    if (action === 'toggleFlag') rec.on = !!args.on
    actions.push(rec)
    ctx.log(`🛠 ${action}(${target}${key ? `, ${String(args[key])}` : ''})${approval ? '' : L(' ⚠️ 未经审批', ' ⚠️ NOT APPROVED')}`)
    if (recoveredAt === undefined && inc.fixed?.(actions)) recoveredAt = now
    now += 3
    return `${out}${approval ? '' : L('（注意：没有找到对应的审批记录，此操作已记入审计日志）', ' (note: no matching approval found; this action has been written to the audit log)')}`
  }

  const ops: OpsEnv = {
    listServices: traced('listServices', 20, () => [...services.values()].map((s) => ({ ...s }))),
    getTopology: traced('getTopology', 20, () => ({ edges: EDGES.map(([from, to]) => ({ from, to })) })),
    getMetrics: traced('getMetrics', 40, (service: string, metric: string, windowMin?: number) => {
      const s = svc(service)
      if (s.kind === 'external') fail(L(`${s.name} 是外部依赖，我们没有它的内部指标；请查看调用方服务的指标和日志。`, `${s.name} is an external dependency; we don't have its internal metrics. Check the calling service's metrics and logs.`))
      const allowed = METRICS_BY_KIND[s.kind as Exclude<typeof s.kind, 'external'>]
      const m = String(metric ?? '').trim() as Metric
      if (!allowed.includes(m)) fail(L(`${s.name} 没有指标 ${metric || '（空）'}。可用指标：${allowed.join('、')}`, `${s.name} has no metric ${metric || '(empty)'}. Available metrics: ${allowed.join(', ')}`))
      const w = windowOf(windowMin)
      const points: MetricSeries['points'] = []
      for (let i = now - w + 1; i <= now; i++) points.push({ t: clock(i), v: value(s.name, m, i) })
      return { service: s.name, metric: m, unit: UNITS[m], points }
    }),
    searchLogs: traced('searchLogs', 60, (service: string, query: string, windowMin?: number) => {
      const s = svc(service)
      if (s.kind === 'external') fail(L(`${s.name} 是外部依赖，看不到它的日志；请查看调用方服务的日志。`, `${s.name} is an external dependency; its logs aren't visible. Check the calling service's logs.`))
      const w = windowOf(windowMin)
      const q = String(query ?? '').trim()
      const tokens = q === '*' ? [] : q.toLowerCase().split(/\s+/).filter(Boolean)
      const all = logLines(s.name, now - w + 1, now).filter((l) => tokens.every((t) => l.line.toLowerCase().includes(t)))
      return { service: s.name, query: q, total: all.length, lines: all.map((l) => l.line).reverse().slice(0, 20) }
    }),
    getDeployHistory: traced('getDeployHistory', 30, (service: string) => changes[svc(service).name].slice(0, 10)),
    getRunbook: traced('getRunbook', 20, (topic: string) => {
      const t = String(topic ?? '').toLowerCase()
      const score = (r: (typeof RUNBOOKS)[number]) => (r.topic.toLowerCase().includes(t) && t ? 10 : 0) + r.keywords.filter((k) => t.includes(k.toLowerCase())).length
      const best = [...RUNBOOKS].sort((a, b) => score(b) - score(a))[0]
      if (!t || score(best) === 0) return L(`没有找到“${topic}”相关的手册。现有手册：${RUNBOOKS.map((r) => r.topic).join('、')}`, `No runbook found for "${topic}". Available runbooks: ${RUNBOOKS.map((r) => r.topic).join(', ')}`)
      return best.text
    }),
    requestApproval: traced('requestApproval', 500, (req: ApprovalRequest) => {
      const decision = decide(req ?? ({} as ApprovalRequest))
      const args = { ...((req?.args ?? {}) as Record<string, unknown>) }
      approvals.push({ action: req?.action, args, reason: String(req?.reason ?? ''), target: targetOf(args), decision, used: false })
      ctx.log(L(`👮 审批 ${String(req?.action)}(${targetOf(args)})：${decision.approved ? '批准' : decision.comment}`, `👮 approval ${String(req?.action)}(${targetOf(args)}): ${decision.approved ? 'approved' : decision.comment}`))
      return decision
    }),
    rollback: traced('rollback', 200, (service: string, version: string) => {
      const s = svc(service)
      if (s.kind === 'external') fail(L(`${s.name} 是外部依赖，不能回滚`, `${s.name} is an external dependency and can't be rolled back`))
      const v = String(version ?? '').trim()
      const hit = changes[s.name].find((c) => c.version === v)
      if (!hit) fail(
          L(
            `版本 ${v || '（空）'} 不在 ${s.name} 的变更历史里。可用版本：${changes[s.name].flatMap((c) => c.version ?? []).join('、') || '无'}`,
            `Version ${v || '(empty)'} isn't in ${s.name}'s change history. Available versions: ${changes[s.name].flatMap((c) => c.version ?? []).join(', ') || 'none'}`,
          ),
        )
      if (s.version === v) fail(L(`${s.name} 当前已经是 ${v}`, `${s.name} is already on ${v}`))
      return remediate('rollback', { service: s.name, version: v }, () => {
        s.version = v
        changes[s.name].unshift({ time: `2026-09-20 ${clock(now)}`, type: 'rollback', version: v, summary: L(`回滚到 ${v}`, `Roll back to ${v}`), author: 'oncall-agent' })
        return L(`已把 ${s.name} 回滚到 ${v}（滚动发布约 3 分钟）`, `Rolled ${s.name} back to ${v} (rolling deploy, about 3 minutes)`)
      })
    }),
    restart: traced('restart', 200, (service: string) => {
      const s = svc(service)
      if (s.kind === 'external') fail(L(`${s.name} 是外部依赖，不能重启`, `${s.name} is an external dependency and can't be restarted`))
      return remediate('restart', { service: s.name }, () => L(`已滚动重启 ${s.name} 的 ${s.replicas ?? 1} 个实例`, `Rolling restart of ${s.replicas ?? 1} ${s.name} instances done`))
    }),
    scale: traced('scale', 200, (service: string, replicas: number) => {
      const s = svc(service)
      if (s.kind !== 'service') fail(L(`${s.name} 是${s.kind === 'external' ? '外部依赖' : '有状态组件'}，不能用 scale 扩缩容`, `${s.name} is ${s.kind === 'external' ? 'an external dependency' : 'a stateful component'} and can't be scaled with scale`))
      const n = Number(replicas)
      if (!Number.isInteger(n) || n < 0 || n > 50) fail(L(`replicas 必须是 0~50 的整数，收到：${JSON.stringify(replicas)}`, `replicas must be an integer from 0 to 50, got: ${JSON.stringify(replicas)}`))
      return remediate('scale', { service: s.name, replicas: n }, () => {
        const before = s.replicas
        s.replicas = n
        changes[s.name].unshift({ time: `2026-09-20 ${clock(now)}`, type: 'scale', summary: `scale ${before} → ${n}`, author: 'oncall-agent' })
        return L(`已把 ${s.name} 的副本数从 ${before} 调整为 ${n}`, `Scaled ${s.name} from ${before} to ${n} replicas`)
      })
    }),
    toggleFlag: traced('toggleFlag', 100, (name: string, on: boolean) => {
      const f = flags.find((x) => x.name === String(name ?? '').trim()) ?? fail(L(`功能开关 ${name} 不存在。现有开关：${flags.map((x) => x.name).join('、')}`, `Feature flag ${name} doesn't exist. Flags: ${flags.map((x) => x.name).join(', ')}`))
      if (typeof on !== 'boolean') fail(L(`on 必须是 true / false，收到：${JSON.stringify(on)}`, `on must be true / false, got: ${JSON.stringify(on)}`))
      return remediate('toggleFlag', { name: f.name, on }, () => {
        const before = f.on
        f.on = on
        changes[f.owner].unshift({ time: `2026-09-20 ${clock(now)}`, type: 'flag', summary: `${f.name}: ${before ? 'on' : 'off'} → ${on ? 'on' : 'off'}`, author: 'oncall-agent' })
        return L(`已把功能开关 ${f.name} 设为 ${on ? 'on' : 'off'}`, `Feature flag ${f.name} set to ${on ? 'on' : 'off'}`)
      })
    }),
    failover: traced('failover', 500, (dbCluster: string) => {
      const s = svc(dbCluster)
      if (s.kind !== 'database') fail(L(`${s.name} 不是数据库集群，不能做主从切换`, `${s.name} isn't a database cluster; can't fail over`))
      return remediate('failover', { cluster: s.name }, () => L(`已把 ${s.name} 切换到从库 ${s.name}-1（写中断约 30 秒）`, `Failed ${s.name} over to replica ${s.name}-1 (about 30 seconds of write downtime)`))
    }),
  }

  return {
    ops,
    alert: inc.alert,
    incident: inc,
    approvals,
    actions,
    healthy: () => (inc.fixed ? recoveredAt !== undefined : true),
  }
}
