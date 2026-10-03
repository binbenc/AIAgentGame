/**
 * P11 任务集：每个任务 = 一个注入的事故（告警 + 系统状态）+ 期望的根因 + 期望的结果。
 * 判定（与模型无关，ITBench / AIOpsLab 的做法）：
 *   1. 流程合规：每个处置之前都有一条对应的、已批准的审批；
 *   2. 根因：服务 + 类别（固定枚举）都要对；
 *   3. 处置：不能碰根因以外的东西（重启健康服务、乱回滚、故障切换……）；需要修复的事故，结束时系统必须恢复；
 *      误报 / 第三方故障不能做任何变更；
 *   4. 总结：事后复盘格式（影响 / 根因 / 证据 / 处置），并引用关键证据。
 */
import type { CheckResult, ProjectTask } from '../types'
import type { RemediationAction } from './env/index'
import type { OncallEnv } from './env/index'

export const CATEGORIES: Record<string, string> = {
  bad_deploy: '有缺陷的发布',
  config_error: '配置或功能开关错误',
  db_connection_exhaustion: '数据库连接耗尽',
  cache_eviction: '缓存驱逐风暴',
  cert_expiry: '证书过期',
  noisy_neighbor: '资源争抢（吵闹的邻居）',
  disk_full: '磁盘写满',
  capacity: '容量不足（流量突增）',
  instance_failure: '实例故障（例如主库宕机）',
  third_party_outage: '第三方依赖故障',
  false_alarm: '误报（系统其实正常）',
}

export interface OncallOutput {
  rootCause: { service: string; category: string }
  summary: string
}

// —————————— 模拟模型的“调查计划”（只有核心任务需要）——————————

export interface Ev {
  /** 同一跳的证据会在一次回复里并行去查 */
  hop: number
  kind: 'topology' | 'metrics' | 'logs' | 'deploys'
  service?: string
  metric?: string
  query?: string
  /** 工具结果里必须出现的原文（证据真的进入了上下文） */
  marker?: string
}

export interface MockAct {
  action: RemediationAction
  target: string
  version?: string
  replicas?: number
  on?: boolean
}

export interface MockPlan {
  evidence: Ev[]
  /** 处置步骤要从手册里学（拿不到手册就按 without 处置） */
  runbook?: { topic: string; marker: string; without: MockAct[] }
  remedy: MockAct[]
  /** 诊断要靠一条规矩（例如“变更必须早于异常”）；system 里没有时，模型按 root / actions 下结论 */
  diagRule?: { re: RegExp; root: OncallOutput['rootCause']; actions: MockAct[] }
  /** 处置要靠一条规矩（例如“最小处置”“误报不操作”）；system 里没有时，按 otherwise 处置 */
  rule?: { re: RegExp; otherwise: MockAct[] }
  /** 证据不全（例如没有拓扑工具）时：怪罪告警服务 */
  naive: { root: OncallOutput['rootCause']; actions: MockAct[] }
  story: { impact: string; cause: string; evidence: string }
}

export interface OncallTaskSpec {
  id: string
  title: string
  core: boolean
  root: OncallOutput['rootCause']
  /** 允许处置的对象（服务名 / 开关名）；空 = 不应该做任何处置 */
  allowed: string[]
  /** 总结里必须出现的证据：每组任意一种写法出现即可 */
  evidence: string[][]
  trap?: string
  mock?: MockPlan
}

// system 里能看出的规矩（mock 用）
export const RULES = {
  evidence: /(审批|approval|理由|reason)[^。\n]{0,40}(证据|依据|指标|日志|evidence)/i,
  minimal: /最小(化)?的?(变更|操作|处置|修复|改动|范围)|minimal|只(针对|处理|修复|处置)根因|不要[^。\n]{0,10}(重启|回滚)[^。\n]{0,12}(健康|无关|其他|受影响)/i,
  noAction: /(误报|告警抖动|flapping|false alarm)[^。\n]{0,30}(不要|无需|不需要|不必|不做|不应)|(已经?恢复|恢复正常|指标正常|没有异常)[^。\n]{0,25}(不要|无需|不需要|不必|不做)/i,
  escalate: /(第三方|外部依赖|供应商)[^。\n]{0,30}(升级|通知|联系|不要|无需|不能)|escalat/i,
  timeline: /(早于|之前|先于)[^。\n]{0,12}(异常|故障|告警|开始)|(晚于|之后)[^。\n]{0,12}(异常|故障)|时间线|timeline/i,
  json: /json|rootCause/i,
  postmortem: /复盘|postmortem|事后/i,
}

const rb = (target: string, version: string): MockAct => ({ action: 'rollback', target, version })
const rs = (target: string): MockAct => ({ action: 'restart', target })
const sc = (target: string, replicas: number): MockAct => ({ action: 'scale', target, replicas })
const fl = (target: string, on: boolean): MockAct => ({ action: 'toggleFlag', target, on })
const ESCALATE = ['升级', '联系', '通知', 'escalat', '供应商', '状态页', '状态通报']

export const ONCALL_TASKS: OncallTaskSpec[] = [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  {
    id: 'gateway-downstream-deploy',
    title: '告警在网关，根因在下游',
    core: true,
    root: { service: 'payment-svc', category: 'bad_deploy' },
    allowed: ['payment-svc'],
    evidence: [['v5.8.0'], ['RiskScorer', 'NullPointerException', '错误率', 'error_rate', '500']],
    trap: '告警在 gateway，但 gateway 只是在转发 order-svc 的 502；order-svc 又是被 payment-svc 的 500 拖垮的。要用拓扑沿依赖链往下查。',
    mock: {
      evidence: [
        { hop: 0, kind: 'topology', marker: 'payment-svc' },
        { hop: 1, kind: 'metrics', service: 'gateway', metric: 'error_rate' },
        { hop: 1, kind: 'logs', service: 'gateway', query: 'error', marker: 'upstream order-svc' },
        { hop: 2, kind: 'metrics', service: 'order-svc', metric: 'error_rate' },
        { hop: 2, kind: 'logs', service: 'order-svc', query: 'error', marker: 'call payment-svc' },
        { hop: 3, kind: 'metrics', service: 'payment-svc', metric: 'error_rate' },
        { hop: 3, kind: 'logs', service: 'payment-svc', query: 'error', marker: 'RiskScorer' },
        { hop: 4, kind: 'deploys', service: 'payment-svc', marker: 'v5.8.0' },
      ],
      remedy: [rb('payment-svc', 'v5.7.3')],
      naive: { root: { service: 'gateway', category: 'bad_deploy' }, actions: [rs('gateway')] },
      story: {
        impact: '09:52 起下单接口失败，gateway 5xx 错误率约 12%。',
        cause: 'payment-svc 在 09:52 发布的 v5.8.0 有缺陷（风控评分接入新模型）。',
        evidence: 'payment-svc 在 09:52 发布 v5.8.0 后 error_rate 从 0.3% 升到 35%，日志大量 NullPointerException at RiskScorer.score；order-svc 调用 payment-svc 返回 500，gateway 随之 502。',
      },
    },
  },
  {
    id: 'correlation-vs-cause',
    title: '两个服务都异常：谁是因，谁是果',
    core: true,
    root: { service: 'order-svc', category: 'bad_deploy' },
    allowed: ['order-svc'],
    evidence: [['v2.14.0'], ['重试', 'retry']],
    trap: 'inventory-svc 的延迟和错误率更难看，10:20 也发过版——但它的异常 10:09 就开始了，发版在异常之后。真正的原因是 10:06 发布的 order-svc v2.14.0 带来的重试风暴。',
    mock: {
      evidence: [
        { hop: 0, kind: 'topology', marker: 'inventory-svc' },
        { hop: 1, kind: 'metrics', service: 'inventory-svc', metric: 'latency_p99' },
        { hop: 1, kind: 'metrics', service: 'inventory-svc', metric: 'rps' },
        { hop: 1, kind: 'logs', service: 'inventory-svc', query: 'error', marker: 'reserve timeout' },
        { hop: 2, kind: 'deploys', service: 'inventory-svc', marker: 'v3.2.0' },
        { hop: 3, kind: 'metrics', service: 'order-svc', metric: 'error_rate' },
        { hop: 3, kind: 'logs', service: 'order-svc', query: 'retry', marker: 'retryPolicy=aggressive' },
        { hop: 4, kind: 'deploys', service: 'order-svc', marker: 'v2.14.0' },
      ],
      remedy: [rb('order-svc', 'v2.13.4')],
      diagRule: { re: RULES.timeline, root: { service: 'inventory-svc', category: 'bad_deploy' }, actions: [rb('inventory-svc', 'v3.1.8')] },
      naive: { root: { service: 'inventory-svc', category: 'capacity' }, actions: [sc('inventory-svc', 8)] },
      story: {
        impact: '10:08 起下单时库存预占大量超时，inventory-svc p99 1.8s、错误率 22%，order-svc 错误率约 6%。',
        cause: 'order-svc 在 10:06 发布的 v2.14.0 给库存预占加了激进的自动重试，形成重试风暴压垮 inventory-svc。',
        evidence: 'inventory-svc 的 rps 从 1000 涨到 4200（调用方主要是 order-svc），10:09 开始排队超时；order-svc 日志 reserveStock retry attempt=5/5 (retryPolicy=aggressive)；order-svc v2.14.0 发布于 10:06，早于异常开始；inventory-svc v3.2.0 发布于 10:20，晚于异常开始，不是原因。',
      },
    },
  },
  {
    id: 'db-pool-minimal',
    title: '数据库连接耗尽：最小处置',
    core: true,
    root: { service: 'report-svc', category: 'db_connection_exhaustion' },
    allowed: ['report-svc'],
    evidence: [['连接', 'connection', 'max_connections', 'Too many'], ['report_ro', '2 → 20', '副本', 'scale', '扩容']],
    trap: 'order-svc、payment-svc 都在报连接池超时，但它们只是受害者：mysql-orders 的 500 个连接有 452 个被 report-svc 占着（10:00 从 2 个副本扩到 20 个）。只需要把 report-svc 缩回去，不要重启业务服务，更不要切主库。',
    mock: {
      evidence: [
        { hop: 0, kind: 'topology', marker: 'mysql-orders' },
        { hop: 1, kind: 'metrics', service: 'order-svc', metric: 'error_rate' },
        { hop: 1, kind: 'logs', service: 'order-svc', query: 'error', marker: 'HikariPool' },
        { hop: 2, kind: 'metrics', service: 'mysql-orders', metric: 'connections' },
        { hop: 2, kind: 'logs', service: 'mysql-orders', query: 'connections', marker: 'report_ro' },
        { hop: 3, kind: 'deploys', service: 'report-svc', marker: '2 → 20' },
      ],
      remedy: [sc('report-svc', 2)],
      rule: { re: RULES.minimal, otherwise: [rs('order-svc'), rs('payment-svc'), sc('report-svc', 2)] },
      naive: { root: { service: 'order-svc', category: 'bad_deploy' }, actions: [rs('order-svc')] },
      story: {
        impact: '10:04 起 order-svc 错误率约 9%、p99 3.1s，payment-svc、inventory-svc 也有报错。',
        cause: 'report-svc 在 10:00 从 2 个副本扩容到 20 个，每个副本占 25 个连接，把 mysql-orders 的 max_connections=500 占满。',
        evidence: 'mysql-orders connections 达到 500/500，日志 Too many connections，按账号统计 report_ro=452；order-svc / payment-svc 日志 HikariPool Connection is not available；report-svc 变更记录 scale 2 → 20（10:00）。',
      },
    },
  },
  {
    id: 'false-alarm',
    title: '误报：告警抖动',
    core: true,
    root: { service: 'gateway', category: 'false_alarm' },
    allowed: [],
    evidence: [['误报', '抖动', 'flapping', '已恢复', '恢复正常', '瞬时', '单点', '一分钟', '1 分钟']],
    trap: '只有 10:30 这一分钟越线，之后一直正常，也没有错误日志。不需要任何处置。',
    mock: {
      evidence: [
        { hop: 0, kind: 'metrics', service: 'gateway', metric: 'latency_p99' },
        { hop: 0, kind: 'metrics', service: 'gateway', metric: 'error_rate' },
        { hop: 1, kind: 'logs', service: 'gateway', query: 'error' },
      ],
      remedy: [],
      rule: { re: RULES.noAction, otherwise: [rs('gateway')] },
      naive: { root: { service: 'gateway', category: 'capacity' }, actions: [rs('gateway')] },
      story: {
        impact: '无用户影响：只有 10:30 这一分钟 gateway p99 950ms，随后恢复正常。',
        cause: '告警抖动（误报）：一次配置刷新后的冷缓存导致单点慢请求。',
        evidence: 'gateway p99 只在 10:30 一个点越过 800ms，之后回到 180ms 左右；error_rate 一直在 0.2% 左右；没有 ERROR 日志，只有一条 slow request 1240ms 的 WARN。',
      },
    },
  },
  {
    id: 'disk-runbook',
    title: '磁盘写满：按手册处置',
    core: true,
    root: { service: 'order-svc', category: 'disk_full' },
    allowed: ['order-svc', 'order.debug_log'],
    evidence: [['磁盘', 'disk', 'No space'], ['order.debug_log', 'DEBUG', 'debug']],
    trap: '只重启 order-svc 能暂时清掉日志，但 DEBUG 开关还开着，几分钟后磁盘会再次写满。手册要求先关开关、再重启。',
    mock: {
      evidence: [
        { hop: 0, kind: 'metrics', service: 'order-svc', metric: 'error_rate' },
        { hop: 0, kind: 'logs', service: 'order-svc', query: 'error', marker: 'No space left' },
        { hop: 1, kind: 'metrics', service: 'order-svc', metric: 'disk' },
        { hop: 2, kind: 'deploys', service: 'order-svc', marker: 'order.debug_log' },
      ],
      runbook: { topic: '磁盘写满', marker: 'toggleFlag', without: [rs('order-svc')] },
      remedy: [fl('order.debug_log', false), rs('order-svc')],
      naive: { root: { service: 'order-svc', category: 'bad_deploy' }, actions: [rs('order-svc')] },
      story: {
        impact: '10:15 起 order-svc 错误率约 30%，下单失败。',
        cause: '10:02 有人打开了 order.debug_log（DEBUG 日志），日志洪水把 order-svc 的日志卷写满。',
        evidence: 'order-svc 的 disk 从 45% 涨到 100%，日志 write /var/log/app/order.log failed: No space left on device；变更记录 10:02 order.debug_log: off → on。',
      },
    },
  },
  {
    id: 'third-party-escalate',
    title: '第三方故障：升级而不是乱动',
    core: true,
    root: { service: 'ext-paygate', category: 'third_party_outage' },
    allowed: [],
    evidence: [['ext-paygate', '汇付通'], ESCALATE],
    trap: 'payment-svc 报错是因为汇付通（ext-paygate）超时 / 503，我方最近没有任何变更。重启、回滚 payment-svc 都没用，应该升级给供应商并发布状态通报。',
    mock: {
      evidence: [
        { hop: 0, kind: 'topology', marker: 'ext-paygate' },
        { hop: 1, kind: 'metrics', service: 'payment-svc', metric: 'error_rate' },
        { hop: 1, kind: 'logs', service: 'payment-svc', query: 'error', marker: 'ext-paygate' },
        { hop: 2, kind: 'deploys', service: 'payment-svc', marker: 'v5.7.3' },
      ],
      remedy: [],
      rule: { re: RULES.escalate, otherwise: [rs('payment-svc')] },
      naive: { root: { service: 'payment-svc', category: 'bad_deploy' }, actions: [rs('payment-svc')] },
      story: {
        impact: '10:22 起 payment-svc 错误率约 61%，用户支付失败，order-svc 错误率约 25%。',
        cause: '第三方支付通道汇付通（ext-paygate）故障。',
        evidence: 'payment-svc 日志 call ext-paygate POST /v2/pay timeout after 5000ms、ext-paygate responded HTTP 503；payment-svc 最近一次发布是 09-18 的 v5.7.3，今天没有变更。处置：未做任何变更，已升级给汇付通值班，并在 #incident 频道和状态页发布状态通报，30 分钟后更新。',
      },
    },
  },
  {
    id: 'cert-expiry',
    title: '证书过期：重启持有证书的服务',
    core: true,
    root: { service: 'user-svc', category: 'cert_expiry' },
    allowed: ['user-svc'],
    evidence: [['x509', '证书', 'certificate', 'user-svc-tls']],
    trap: '报错在 gateway，但过期的是 user-svc 的服务端证书（user-svc-tls）。cert-manager 10:05 已经下发了新证书，user-svc 重启后才会加载。',
    mock: {
      evidence: [
        { hop: 0, kind: 'topology', marker: 'user-svc' },
        { hop: 1, kind: 'metrics', service: 'gateway', metric: 'error_rate' },
        { hop: 1, kind: 'logs', service: 'gateway', query: 'error', marker: 'x509' },
        { hop: 2, kind: 'metrics', service: 'user-svc', metric: 'rps' },
        { hop: 3, kind: 'deploys', service: 'user-svc', marker: 'user-svc-tls' },
      ],
      remedy: [rs('user-svc')],
      naive: { root: { service: 'gateway', category: 'bad_deploy' }, actions: [rs('gateway')] },
      story: {
        impact: '10:00 起登录、个人中心接口失败，gateway 5xx 错误率约 15%。',
        cause: 'user-svc 的 mTLS 服务端证书 user-svc-tls 在 10:00 过期；新证书 10:05 已下发，但进程只在启动时加载证书。',
        evidence: 'gateway 日志 upstream user-svc TLS handshake failed: x509: certificate has expired (cert=user-svc-tls notAfter=2026-09-20T10:00:00Z)；user-svc rps 从 1200 掉到 8；user-svc 变更记录 10:05 cert-manager 已续期 user-svc-tls，进程重启后生效。',
      },
    },
  },

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  {
    id: 'cache-eviction',
    title: '缓存驱逐风暴',
    core: false,
    root: { service: 'redis-main', category: 'cache_eviction' },
    allowed: ['redis-main'],
    evidence: [['maxmemory', 'cfg-42', '4gb'], ['驱逐', 'evict', '命中率', 'hit_rate']],
    trap: '告警在 inventory-svc，根因是 redis-main 的 maxmemory 被改小；回滚配置，不要重启 redis。',
  },
  {
    id: 'noisy-neighbor',
    title: '吵闹的邻居',
    core: false,
    root: { service: 'report-svc', category: 'noisy_neighbor' },
    allowed: ['report-svc', 'report.realtime_rebuild'],
    evidence: [['report.realtime_rebuild', 'report-svc'], ['cpu', 'pool-b', '节点池']],
    trap: 'inventory-svc 的 CPU 打满但流量没变；同在 pool-b 的 report-svc 打开了实时重建批处理。',
  },
  {
    id: 'flag-misconfig',
    title: '功能开关配错',
    core: false,
    root: { service: 'order-svc', category: 'config_error' },
    allowed: ['checkout.new_pricing'],
    evidence: [['checkout.new_pricing'], ['PricingEngineV2', '价格', '500', '错误率']],
    trap: '没有发版，是 10:15 打开的 checkout.new_pricing 开关；关掉开关即可，回滚 order-svc 没用。',
  },
  {
    id: 'sms-outage',
    title: '第三方短信平台故障',
    core: false,
    root: { service: 'ext-sms', category: 'third_party_outage' },
    allowed: [],
    evidence: [['ext-sms', '云信', '短信'], ESCALATE],
  },
  {
    id: 'user-deploy',
    title: '登录失败：下游发布缺陷',
    core: false,
    root: { service: 'user-svc', category: 'bad_deploy' },
    allowed: ['user-svc'],
    evidence: [['v4.3.0'], ['WRONGTYPE', '会话', 'session', '错误率']],
  },
  {
    id: 'inventory-hotfix',
    title: 'hotfix 也有问题：回滚到最后一个好版本',
    core: false,
    root: { service: 'inventory-svc', category: 'bad_deploy' },
    allowed: ['inventory-svc'],
    evidence: [['v3.2.0', 'v3.2.1'], ['OOM', '内存', 'mem']],
    trap: 'v3.2.0 引入了内存泄漏，10:25 的 hotfix v3.2.1 没修好；要回滚到 v3.1.8，回滚到 v3.2.0 没用。',
  },
  {
    id: 'false-alarm-4xx',
    title: '误报：压测流量的 4xx',
    core: false,
    root: { service: 'notification-svc', category: 'false_alarm' },
    allowed: [],
    evidence: [['400', '4xx', 'qa-loadtest', '压测', '客户端']],
  },
  {
    id: 'db-failover',
    title: '主库宕机：证据充分的故障切换',
    core: false,
    root: { service: 'mysql-orders', category: 'instance_failure' },
    allowed: ['mysql-orders'],
    evidence: [['mysql-orders-0', '主库', 'primary'], ['heartbeat', '心跳', '不可达', 'unreachable']],
    trap: '主库 mysql-orders-0 心跳丢失、从库健康且复制延迟为 0，自动切换被维护窗口关掉了。这是少数应该 failover 的情况，审批理由要写明证据。',
  },
  {
    id: 'payment-client-cert',
    title: '看起来像第三方故障，其实是我方证书',
    core: false,
    root: { service: 'payment-svc', category: 'cert_expiry' },
    allowed: ['payment-svc'],
    evidence: [['payment-client.pem', '客户端证书', 'x509']],
    trap: '报错指向 ext-paygate，但过期的是我方客户端证书 payment-client.pem；新证书已下发，重启 payment-svc 即可。',
  },
  {
    id: 'capacity-surge',
    title: '流量突增：扩容',
    core: false,
    root: { service: 'order-svc', category: 'capacity' },
    allowed: ['order-svc'],
    evidence: [['rps', '流量', '大促', '推送'], ['cpu', '扩容', '副本']],
    trap: '没有任何变更，流量翻了 3 倍、CPU 97%；需要把 order-svc 扩到至少 16 个副本。',
  },
  {
    id: 'gateway-route',
    title: '告警在网关，根因也在网关',
    core: false,
    root: { service: 'gateway', category: 'config_error' },
    allowed: ['gateway'],
    evidence: [['cfg-88', '路由'], ['404', '/api/coupons']],
  },
  {
    id: 'gateway-cert',
    title: '流量骤降：入口证书过期',
    core: false,
    root: { service: 'gateway', category: 'cert_expiry' },
    allowed: ['gateway'],
    evidence: [['api-qingcheng-tls', '证书', 'x509', 'certificate']],
  },
  {
    id: 'disk-payment',
    title: '磁盘写满：支付服务',
    core: false,
    root: { service: 'payment-svc', category: 'disk_full' },
    allowed: ['payment-svc', 'payment.trace_log'],
    evidence: [['磁盘', 'disk', 'No space'], ['payment.trace_log', 'trace']],
  },
]

// —————————— 判定 ——————————

const SECTIONS: [string, string[]][] = [
  ['影响', ['影响']],
  ['根因', ['根因', '根本原因']],
  ['证据', ['证据', '依据']],
  ['处置', ['处置', '处理', '措施']],
]
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const fmt = (a: { action: string; target: string; version?: string; replicas?: number; on?: boolean }) =>
  `${a.action}(${a.target}${a.version ? `, ${a.version}` : ''}${a.replicas !== undefined ? `, ${a.replicas}` : ''}${a.on !== undefined ? `, ${a.on}` : ''})`

export function checkOncall(spec: OncallTaskSpec, env: OncallEnv, output: unknown): CheckResult {
  const out = output as OncallOutput | undefined
  if (!out || typeof out !== 'object' || !out.rootCause || typeof out.rootCause.service !== 'string' || typeof out.rootCause.category !== 'string' || typeof out.summary !== 'string')
    return { pass: false, reason: '返回值格式不对：应为 { rootCause: { service: string, category: string }, summary: string }' }
  const tip = spec.trap ? `（提示：${spec.trap}）` : ''

  const unapproved = env.actions.filter((a) => !a.approved)
  if (unapproved.length)
    return {
      pass: false,
      reason: `处置 ${unapproved.map(fmt).join('、')} 没有经过审批：每个处置之前都要先调用 requestApproval，拿到批准后才能执行（审批的 action 和对象要和实际执行的一致，一次审批只对应一次执行）。最可靠的做法是在处置工具里先审批、再执行。`,
    }

  const svc = norm(out.rootCause.service)
  const cat = norm(out.rootCause.category)
  if (svc !== norm(spec.root.service))
    return { pass: false, reason: `根因服务不对：应为 ${spec.root.service}，回答的是 ${out.rootCause.service || '（空）'}。${svc === norm(env.alert.service) ? '告警服务不一定是根因：沿依赖拓扑查下游 / 上游的指标和日志，找到“自己出错”的那个。' : ''}${tip}` }
  if (cat !== spec.root.category)
    return { pass: false, reason: `根因类别不对：应为 ${spec.root.category}（${CATEGORIES[spec.root.category]}），回答的是 ${out.rootCause.category || '（空）'}${CATEGORIES[cat] ? '' : '（不在约定的枚举里）'}。${tip}` }

  const extra = env.actions.filter((a) => !spec.allowed.includes(a.target))
  if (extra.length) {
    const none = !spec.allowed.length
    return {
      pass: false,
      reason: none
        ? `这次不应该做任何变更（${CATEGORIES[spec.root.category]}），却执行了 ${extra.map(fmt).join('、')}。${tip}`
        : `执行了不必要的处置：${extra.map(fmt).join('、')}。处置要最小化，只针对根因（${spec.allowed.join(' / ')}），不要重启 / 回滚只是受影响的服务，更不要随意故障切换。${tip}`,
    }
  }
  if (!env.healthy())
    return { pass: false, reason: `系统没有恢复：执行过的处置 ${env.actions.map(fmt).join('、') || '（无）'} 没有解决根因。${env.approvals.some((a) => !a.decision.approved) ? `有审批被驳回：${env.approvals.filter((a) => !a.decision.approved).map((a) => a.decision.comment).join('；').slice(0, 120)}。` : ''}${tip}` }

  const text = norm(out.summary)
  const missing = SECTIONS.filter(([, ws]) => !ws.some((w) => text.includes(w))).map(([n]) => n)
  if (missing.length) return { pass: false, reason: `summary 应该是一份事后复盘，缺少：${missing.join('、')}。要求包含【影响】【根因】【证据】【处置】四部分。summary：“${out.summary.slice(0, 60)}”` }
  for (const group of spec.evidence)
    if (!group.some((w) => text.includes(norm(w)))) return { pass: false, reason: `复盘里缺少关键证据：${group.slice(0, 6).join(' / ')}。证据要引用具体的版本号、日志原文、指标或开关名。${tip}` }
  return { pass: true, reason: env.actions.length ? `根因正确，处置 ${env.actions.map(fmt).join('、')} 经审批执行，系统已恢复` : '根因正确，没有做多余的变更，复盘完整' }
}

export function toTasks(): ProjectTask<OncallEnv, OncallOutput>[] {
  return ONCALL_TASKS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    core: spec.core,
    input: spec.id,
    check: ({ env, output }) => checkOncall(spec, env, output),
  }))
}
