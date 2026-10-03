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

/** 环境提供的运维 API（原始接口） */
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

const SYSTEM = `你是青橙到家的 SRE on-call Agent，负责处理告警：找到根因、在审批后做最小的处置、写一份事后复盘。

排查流程：
1. 先确认告警是否仍在持续：看告警服务最近 60 分钟的相关指标和错误日志。如果只有一两个点越线、之后已经恢复、也没有新增错误日志（或者只是客户端 4xx / 压测流量），就是误报（告警抖动）：不要做任何处置。
2. 用 get_topology 沿依赖链排查：告警服务报错，往往是被下游依赖拖累的。逐跳查看下游的错误率 / 延迟和错误日志，直到找到“自己出错、而不是被别人拖累”的服务；也要看调用方——上游的重试风暴同样会压垮下游。
3. 查可疑服务的变更历史（发布、配置、开关、扩缩容、证书）。变更时间必须早于异常开始的时间，晚于异常开始的变更不是原因。
4. 用 get_runbook 查对应的运维手册，按手册的步骤和顺序处置。
5. 处置要最小化：只处置根因，不要重启或回滚只是受影响的服务；除非主库实例确实不可达，否则不要做故障切换。
6. 每个处置工具都会先提交审批：reason 里必须写明证据——根因服务、支撑判断的指标数值或日志原文、为什么这个操作能解决问题。审批被驳回就补充证据或停下，不要换别的操作硬上。
7. 第三方依赖（ext-*）故障：我方不做任何变更，升级给供应商，并在总结里写状态通报。
8. 处置之后再看一次指标，确认恢复。

最后只输出一个 JSON 对象，不要输出其它内容：
{"rootCause": {"service": "...", "category": "..."}, "summary": "..."}
- service 必须是 list_services 里的名字（包括 ext-* 外部依赖）；误报填告警服务本身。
- category 只能是：${CATEGORIES.join(' / ')}。
- summary 是一份简短的事后复盘，包含【影响】【根因】【证据】【处置】四部分；证据要引用具体的指标数值、日志原文、版本号或开关名。`

// —————————— 工具输出：压缩成模型好读、token 少的文本 ——————————

/** 指标序列 → 一行摘要 + 每 5 分钟的采样：模型看得出趋势和异常开始的时间 */
export function summarizeSeries(s: { service: string; metric: string; unit: string; points: { t: string; v: number }[] }): string {
  const vs = s.points.map((p) => p.v)
  if (!vs.length) return `${s.service} ${s.metric}：没有数据`
  const head = [...vs.slice(0, Math.max(3, Math.floor(vs.length / 4)))].sort((a, b) => a - b)
  const base = head[Math.floor(head.length / 2)]
  const maxV = Math.max(...vs)
  const maxAt = s.points[vs.indexOf(maxV)].t
  const off = (v: number) => Math.abs(v - base) > Math.max(base * 0.5, s.unit === '%' ? 2 : 1)
  const start = s.points.find((p) => off(p.v))
  const abnormal = vs.filter(off).length
  const samples = s.points.filter((_, i) => i % 5 === 0 || i === s.points.length - 1).map((p) => `${p.t} ${p.v}`)
  return `${s.service} ${s.metric}（${s.unit}）：基线≈${base}，最大 ${maxV}（${maxAt}），当前 ${vs[vs.length - 1]}；${
    start ? `${start.t} 开始偏离基线，共 ${abnormal}/${vs.length} 分钟异常` : '一直在基线附近'
  }\n采样：${samples.join(' | ')}`
}

/** 日志 → 去掉时间戳和编号后按内容合并，附上次数和首末时间 */
export function summarizeLogs(r: { service: string; query: string; total: number; lines: string[] }): string {
  if (!r.total) return `${r.service} 没有匹配“${r.query}”的日志`
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
  return `${r.service} 匹配“${r.query}”的日志共 ${r.total} 条（最近 ${r.lines.length} 条合并后）：\n${rows.join('\n')}`
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required }) as Tool['spec']['input_schema']
const S = (description: string) => ({ type: 'string', description })
const REASON = S('审批理由：根因服务 + 支撑判断的指标数值或日志原文 + 为什么这个操作能解决问题')

export function createOpsTools(env: OpsEnv): Tool[] {
  /** 处置工具：先审批，批准后才执行（流程守卫写在代码里，不靠模型自觉） */
  const gated = (action: RemediationAction, argsOf: (i: any) => Record<string, unknown>, run: (i: any) => Promise<string>) => async (input: any) => {
    const args = argsOf(input)
    const decision = await env.requestApproval({ action, args, reason: String(input.reason ?? '') })
    log(`[审批] ${action} ${JSON.stringify(args)}：${decision.approved ? '批准' : decision.comment}`)
    if (!decision.approved) throw new Error(`审批被驳回（${decision.approver}）：${decision.comment}`)
    return `${await run(input)}。审批人：${decision.approver}（${decision.comment}）`
  }
  return [
    { spec: { name: 'list_services', description: '列出所有服务 / 组件（含 ext-* 外部依赖）：类型、负责人、副本数、当前版本、节点池。', input_schema: obj({}, []) }, run: () => env.listServices() },
    {
      spec: { name: 'get_topology', description: '服务依赖拓扑：每行 “调用方 → 被调用方”。', input_schema: obj({}, []) },
      run: async () => (await env.getTopology()).edges.map((e) => `${e.from} → ${e.to}`).join('\n'),
    },
    {
      spec: {
        name: 'get_metrics',
        description: '查询一个服务的指标（摘要 + 每 5 分钟采样）。服务可用：latency_p99 / error_rate / cpu / mem / rps / connections / disk；redis：evictions / hit_rate 等；mysql：connections 等。',
        input_schema: obj({ service: S('服务名'), metric: S('指标名，例如 error_rate'), window_min: { type: 'integer', description: '时间窗口（分钟，最大 60）' } }, ['service', 'metric']),
      },
      run: async (i) => summarizeSeries(await env.getMetrics(String(i.service), String(i.metric), Number(i.window_min ?? 60))),
    },
    {
      spec: {
        name: 'search_logs',
        description: '搜索一个服务最近的日志（大小写不敏感的关键词，多个词用空格分隔，全部匹配；空字符串返回全部）。相同内容会合并并显示次数。',
        input_schema: obj({ service: S('服务名'), query: S('关键词，例如 "error"'), window_min: { type: 'integer', description: '时间窗口（分钟，最大 60）' } }, ['service', 'query']),
      },
      run: async (i) => summarizeLogs(await env.searchLogs(String(i.service), String(i.query ?? ''), Number(i.window_min ?? 60))),
    },
    {
      spec: { name: 'get_deploy_history', description: '查询一个服务最近的变更（发布、配置、功能开关、扩缩容、证书），新的在前。', input_schema: obj({ service: S('服务名') }, ['service']) },
      run: async (i) => (await env.getDeployHistory(String(i.service))).map((c) => `${c.time} [${c.type}] ${c.version ?? ''} ${c.summary}（${c.author}）`).join('\n'),
    },
    { spec: { name: 'get_runbook', description: '按主题查运维手册，例如 “磁盘写满”“证书过期”“数据库连接耗尽”“第三方依赖故障”。', input_schema: obj({ topic: S('主题关键词') }, ['topic']) }, run: (i) => env.getRunbook(String(i.topic)) },
    {
      spec: { name: 'rollback', description: '回滚服务（或组件配置）到变更历史里的某个版本。会先提交审批。', input_schema: obj({ service: S('服务名'), version: S('目标版本，例如 v5.7.3 或 cfg-41'), reason: REASON }, ['service', 'version', 'reason']) },
      run: gated('rollback', (i) => ({ service: i.service, version: i.version }), (i) => env.rollback(String(i.service), String(i.version))),
    },
    {
      spec: { name: 'restart', description: '滚动重启一个服务。会先提交审批。', input_schema: obj({ service: S('服务名'), reason: REASON }, ['service', 'reason']) },
      run: gated('restart', (i) => ({ service: i.service }), (i) => env.restart(String(i.service))),
    },
    {
      spec: { name: 'scale', description: '调整服务副本数。会先提交审批。', input_schema: obj({ service: S('服务名'), replicas: { type: 'integer', description: '目标副本数' }, reason: REASON }, ['service', 'replicas', 'reason']) },
      run: gated('scale', (i) => ({ service: i.service, replicas: Number(i.replicas) }), (i) => env.scale(String(i.service), Number(i.replicas))),
    },
    {
      spec: { name: 'toggle_flag', description: '打开 / 关闭功能开关。会先提交审批。', input_schema: obj({ name: S('开关名'), on: { type: 'boolean', description: 'true 打开，false 关闭' }, reason: REASON }, ['name', 'on', 'reason']) },
      run: gated('toggleFlag', (i) => ({ name: i.name, on: i.on === true || i.on === 'true' }), (i) => env.toggleFlag(String(i.name), i.on === true || i.on === 'true')),
    },
    {
      spec: { name: 'failover', description: '数据库主从切换（高风险：写中断约 30 秒）。只有主库实例不可达时使用。会先提交审批。', input_schema: obj({ cluster: S('数据库集群名'), reason: REASON }, ['cluster', 'reason']) },
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
    /* 落到兜底 */
  }
  log(`无法解析诊断结果，使用兜底：${text.slice(0, 100)}`)
  return { rootCause: { service: alert.service, category: 'false_alarm' }, summary: `【影响】未知【根因】未能确定【证据】无【处置】未做变更，需要人工排查。原始输出：${text.slice(0, 200)}` }
}

export async function respond(alert: Alert, env: OpsEnv): Promise<Diagnosis> {
  const task = `收到告警：\n${JSON.stringify(alert, null, 2)}\n\n请按流程排查、处置并输出 JSON。`
  const res = await runAgent(task, createOpsTools(env), { system: SYSTEM, maxSteps: 25 })
  log(`on-call Agent 结束：${res.stopReason}，共 ${res.steps} 步`)
  return parseDiagnosis(res.output, alert)
}
