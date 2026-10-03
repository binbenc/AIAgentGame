/**
 * P11 任务集：每个任务 = 一个注入的事故（告警 + 系统状态）+ 期望的根因 + 期望的结果。
 * 判定（与模型无关，ITBench / AIOpsLab 的做法）：
 *   1. 流程合规：每个处置之前都有一条对应的、已批准的审批；
 *   2. 根因：服务 + 类别（固定枚举）都要对；
 *   3. 处置：不能碰根因以外的东西（重启健康服务、乱回滚、故障切换……）；需要修复的事故，结束时系统必须恢复；
 *      误报 / 第三方故障不能做任何变更；
 *   4. 总结：事后复盘格式（影响 / 根因 / 证据 / 处置），并引用关键证据。
 */
import { L } from '../../engine/locale'
import type { CheckResult, ProjectTask } from '../types'
import type { RemediationAction } from './env/index'
import type { OncallEnv } from './env/index'

export const CATEGORIES: Record<string, string> = {
  bad_deploy: L('有缺陷的发布', 'Bad deploy'),
  config_error: L('配置或功能开关错误', 'Bad config or feature flag'),
  db_connection_exhaustion: L('数据库连接耗尽', 'Database connection exhaustion'),
  cache_eviction: L('缓存驱逐风暴', 'Cache eviction storm'),
  cert_expiry: L('证书过期', 'Certificate expired'),
  noisy_neighbor: L('资源争抢（吵闹的邻居）', 'Resource contention (noisy neighbor)'),
  disk_full: L('磁盘写满', 'Disk full'),
  capacity: L('容量不足（流量突增）', 'Insufficient capacity (traffic surge)'),
  instance_failure: L('实例故障（例如主库宕机）', 'Instance failure (e.g. primary DB down)'),
  third_party_outage: L('第三方依赖故障', 'Third-party dependency outage'),
  false_alarm: L('误报（系统其实正常）', 'False alarm (the system is actually fine)'),
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
  evidence: /(审批|approval|理由|reason)[^。\n]{0,40}(证据|依据|指标|日志|evidence)|(approv|reason|justif)[^\n]{0,60}(evidence|metric|log line|logs)/i,
  minimal:
    /最小(化)?的?(变更|操作|处置|修复|改动|范围)|minimal|只(针对|处理|修复|处置)根因|不要[^。\n]{0,10}(重启|回滚)[^。\n]{0,12}(健康|无关|其他|受影响)|only (fix|remediate|touch|act on|change)[^.\n]{0,20}root cause|(don't|do not|never) (restart|roll back|rollback)[^.\n]{0,30}(healthy|unrelated|other|affected|victim)/i,
  noAction:
    /(误报|告警抖动|flapping|false alarm)[^。\n]{0,30}(不要|无需|不需要|不必|不做|不应)|(已经?恢复|恢复正常|指标正常|没有异常)[^。\n]{0,25}(不要|无需|不需要|不必|不做)|(false alarm|false positive|flapping|flap)[^.\n]{0,60}(don't|do not|no (action|change|remediation)|nothing|never)|(already recovered|back to normal|recovered)[^.\n]{0,40}(don't|do not|no (action|change)|nothing)/i,
  escalate: /(第三方|外部依赖|供应商)[^。\n]{0,30}(升级|通知|联系|不要|无需|不能)|escalat|(third[- ]party|vendor|external dependenc)[^.\n]{0,40}(notify|contact|don't|do not|no change|status update)/i,
  timeline:
    /(早于|之前|先于)[^。\n]{0,12}(异常|故障|告警|开始)|(晚于|之后)[^。\n]{0,12}(异常|故障)|时间线|timeline|(before|precede|earlier than)[^.\n]{0,20}(anomal|incident|onset|problem|errors? start)|after[^.\n]{0,20}(onset|anomal)/i,
  json: /json|rootCause/i,
  postmortem: /复盘|postmortem|事后|post-mortem/i,
}

const rb = (target: string, version: string): MockAct => ({ action: 'rollback', target, version })
const rs = (target: string): MockAct => ({ action: 'restart', target })
const sc = (target: string, replicas: number): MockAct => ({ action: 'scale', target, replicas })
const fl = (target: string, on: boolean): MockAct => ({ action: 'toggleFlag', target, on })
const ESCALATE_ZH = ['升级', '联系', '通知', 'escalat', '供应商', '状态页', '状态通报']
const ESCALATE = L(ESCALATE_ZH, [...ESCALATE_ZH, 'vendor', 'status page', 'status update', 'contact', 'notif'])
/** 证据关键词：中文版原样；英文版在每组后面追加英文写法 */
const ev = (zh: string[][], en: string[][] = []) => L(zh, zh.map((g, i) => [...g, ...(en[i] ?? [])]))

export const ONCALL_TASKS: OncallTaskSpec[] = [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  {
    id: 'gateway-downstream-deploy',
    title: L('告警在网关，根因在下游', 'Alert on the gateway, root cause downstream'),
    core: true,
    root: { service: 'payment-svc', category: 'bad_deploy' },
    allowed: ['payment-svc'],
    evidence: ev([['v5.8.0'], ['RiskScorer', 'NullPointerException', '错误率', 'error_rate', '500']], [[], ['error rate']]),
    trap: L('告警在 gateway，但 gateway 只是在转发 order-svc 的 502；order-svc 又是被 payment-svc 的 500 拖垮的。要用拓扑沿依赖链往下查。', 'The alert is on gateway, but gateway is just passing on order-svc\'s 502s, and order-svc is being dragged down by payment-svc\'s 500s. Use the topology to follow the dependency chain downstream.'),
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
        impact: L('09:52 起下单接口失败，gateway 5xx 错误率约 12%。', 'Checkout API failing since 09:52; gateway 5xx error rate around 12%.'),
        cause: L('payment-svc 在 09:52 发布的 v5.8.0 有缺陷（风控评分接入新模型）。', 'payment-svc v5.8.0, deployed at 09:52, is buggy (risk scoring switched to the new model).'),
        evidence: L('payment-svc 在 09:52 发布 v5.8.0 后 error_rate 从 0.3% 升到 35%，日志大量 NullPointerException at RiskScorer.score；order-svc 调用 payment-svc 返回 500，gateway 随之 502。', 'After payment-svc deployed v5.8.0 at 09:52, error_rate rose from 0.3% to 35% and logs are full of NullPointerException at RiskScorer.score; order-svc calls to payment-svc return 500, so gateway returns 502.'),
      },
    },
  },
  {
    id: 'correlation-vs-cause',
    title: L('两个服务都异常：谁是因，谁是果', 'Two services misbehaving: which is cause, which is effect'),
    core: true,
    root: { service: 'order-svc', category: 'bad_deploy' },
    allowed: ['order-svc'],
    evidence: ev([['v2.14.0'], ['重试', 'retry']]),
    trap: L('inventory-svc 的延迟和错误率更难看，10:20 也发过版——但它的异常 10:09 就开始了，发版在异常之后。真正的原因是 10:06 发布的 order-svc v2.14.0 带来的重试风暴。', 'inventory-svc has the worse latency and error rate and also deployed at 10:20 — but its anomaly started at 10:09, before that deploy. The real cause is the retry storm from order-svc v2.14.0, shipped at 10:06.'),
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
        impact: L('10:08 起下单时库存预占大量超时，inventory-svc p99 1.8s、错误率 22%，order-svc 错误率约 6%。', 'Since 10:08 stock reservations at checkout mostly time out; inventory-svc p99 1.8s, error rate 22%; order-svc error rate around 6%.'),
        cause: L('order-svc 在 10:06 发布的 v2.14.0 给库存预占加了激进的自动重试，形成重试风暴压垮 inventory-svc。', 'order-svc v2.14.0, shipped at 10:06, added aggressive auto-retry to stock reservation; the retry storm overwhelmed inventory-svc.'),
        evidence: L('inventory-svc 的 rps 从 1000 涨到 4200（调用方主要是 order-svc），10:09 开始排队超时；order-svc 日志 reserveStock retry attempt=5/5 (retryPolicy=aggressive)；order-svc v2.14.0 发布于 10:06，早于异常开始；inventory-svc v3.2.0 发布于 10:20，晚于异常开始，不是原因。', 'inventory-svc rps rose from 1000 to 4200 (mostly from order-svc) and queue timeouts started at 10:09; order-svc logs reserveStock retry attempt=5/5 (retryPolicy=aggressive); order-svc v2.14.0 shipped at 10:06, before the onset; inventory-svc v3.2.0 shipped at 10:20, after the onset, so it\'s not the cause.'),
      },
    },
  },
  {
    id: 'db-pool-minimal',
    title: L('数据库连接耗尽：最小处置', 'DB connection exhaustion: minimal remediation'),
    core: true,
    root: { service: 'report-svc', category: 'db_connection_exhaustion' },
    allowed: ['report-svc'],
    evidence: ev([['连接', 'connection', 'max_connections', 'Too many'], ['report_ro', '2 → 20', '副本', 'scale', '扩容']], [[], ['replica']]),
    trap: L('order-svc、payment-svc 都在报连接池超时，但它们只是受害者：mysql-orders 的 500 个连接有 452 个被 report-svc 占着（10:00 从 2 个副本扩到 20 个）。只需要把 report-svc 缩回去，不要重启业务服务，更不要切主库。', 'order-svc and payment-svc both report connection-pool timeouts, but they\'re only victims: report-svc holds 452 of mysql-orders\' 500 connections (it scaled from 2 to 20 replicas at 10:00). Just scale report-svc back down — don\'t restart business services, and definitely don\'t fail over the database.'),
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
        impact: L('10:04 起 order-svc 错误率约 9%、p99 3.1s，payment-svc、inventory-svc 也有报错。', 'Since 10:04 order-svc error rate around 9%, p99 3.1s; payment-svc and inventory-svc erroring too.'),
        cause: L('report-svc 在 10:00 从 2 个副本扩容到 20 个，每个副本占 25 个连接，把 mysql-orders 的 max_connections=500 占满。', 'report-svc scaled from 2 to 20 replicas at 10:00; at 25 connections each they used up mysql-orders\' max_connections=500.'),
        evidence: L('mysql-orders connections 达到 500/500，日志 Too many connections，按账号统计 report_ro=452；order-svc / payment-svc 日志 HikariPool Connection is not available；report-svc 变更记录 scale 2 → 20（10:00）。', 'mysql-orders connections hit 500/500, logs say Too many connections, per account report_ro=452; order-svc / payment-svc log HikariPool Connection is not available; report-svc change log: scale 2 → 20 (10:00).'),
      },
    },
  },
  {
    id: 'false-alarm',
    title: L('误报：告警抖动', 'False alarm: flapping alert'),
    core: true,
    root: { service: 'gateway', category: 'false_alarm' },
    allowed: [],
    evidence: ev([['误报', '抖动', 'flapping', '已恢复', '恢复正常', '瞬时', '单点', '一分钟', '1 分钟']], [['false alarm', 'false positive', 'flap', 'transient', 'recovered', 'back to normal', 'single point', 'one minute', 'single minute', 'blip']]),
    trap: L('只有 10:30 这一分钟越线，之后一直正常，也没有错误日志。不需要任何处置。', 'Only the 10:30 minute crossed the threshold; it\'s been normal since, with no error logs. No remediation needed.'),
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
        impact: L('无用户影响：只有 10:30 这一分钟 gateway p99 950ms，随后恢复正常。', 'No user impact: gateway p99 was 950ms for the 10:30 minute only, then back to normal.'),
        cause: L('告警抖动（误报）：一次配置刷新后的冷缓存导致单点慢请求。', 'Alert flapping (false alarm): a cold cache after a config reload caused one slow data point.'),
        evidence: L('gateway p99 只在 10:30 一个点越过 800ms，之后回到 180ms 左右；error_rate 一直在 0.2% 左右；没有 ERROR 日志，只有一条 slow request 1240ms 的 WARN。', 'gateway p99 crossed 800ms at a single point (10:30), then went back to ~180ms; error_rate stayed around 0.2%; no ERROR logs, just one WARN for a slow request of 1240ms.'),
      },
    },
  },
  {
    id: 'disk-runbook',
    title: L('磁盘写满：按手册处置', 'Disk full: follow the runbook'),
    core: true,
    root: { service: 'order-svc', category: 'disk_full' },
    allowed: ['order-svc', 'order.debug_log'],
    evidence: ev([['磁盘', 'disk', 'No space'], ['order.debug_log', 'DEBUG', 'debug']]),
    trap: L('只重启 order-svc 能暂时清掉日志，但 DEBUG 开关还开着，几分钟后磁盘会再次写满。手册要求先关开关、再重启。', 'Restarting order-svc alone clears the logs for a while, but the DEBUG flag is still on and the disk fills up again within minutes. The runbook says: turn the flag off first, then restart.'),
    mock: {
      evidence: [
        { hop: 0, kind: 'metrics', service: 'order-svc', metric: 'error_rate' },
        { hop: 0, kind: 'logs', service: 'order-svc', query: 'error', marker: 'No space left' },
        { hop: 1, kind: 'metrics', service: 'order-svc', metric: 'disk' },
        { hop: 2, kind: 'deploys', service: 'order-svc', marker: 'order.debug_log' },
      ],
      runbook: { topic: L('磁盘写满', 'Disk full'), marker: 'toggleFlag', without: [rs('order-svc')] },
      remedy: [fl('order.debug_log', false), rs('order-svc')],
      naive: { root: { service: 'order-svc', category: 'bad_deploy' }, actions: [rs('order-svc')] },
      story: {
        impact: L('10:15 起 order-svc 错误率约 30%，下单失败。', 'Since 10:15 order-svc error rate around 30%; checkouts failing.'),
        cause: L('10:02 有人打开了 order.debug_log（DEBUG 日志），日志洪水把 order-svc 的日志卷写满。', 'Someone turned on order.debug_log (DEBUG logging) at 10:02 and the log flood filled order-svc\'s log volume.'),
        evidence: L('order-svc 的 disk 从 45% 涨到 100%，日志 write /var/log/app/order.log failed: No space left on device；变更记录 10:02 order.debug_log: off → on。', 'order-svc disk went from 45% to 100%, logs say write /var/log/app/order.log failed: No space left on device; change log at 10:02: order.debug_log: off → on.'),
      },
    },
  },
  {
    id: 'third-party-escalate',
    title: L('第三方故障：升级而不是乱动', 'Third-party outage: escalate, don\'t tinker'),
    core: true,
    root: { service: 'ext-paygate', category: 'third_party_outage' },
    allowed: [],
    evidence: ev([['ext-paygate', '汇付通'], ESCALATE], [['HuiPay']]),
    trap: L('payment-svc 报错是因为汇付通（ext-paygate）超时 / 503，我方最近没有任何变更。重启、回滚 payment-svc 都没用，应该升级给供应商并发布状态通报。', 'payment-svc is failing because HuiPay (ext-paygate) times out / returns 503, and we haven\'t changed anything. Restarting or rolling back payment-svc won\'t help; escalate to the vendor and post a status update.'),
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
        impact: L('10:22 起 payment-svc 错误率约 61%，用户支付失败，order-svc 错误率约 25%。', 'Since 10:22 payment-svc error rate around 61%, user payments failing; order-svc error rate around 25%.'),
        cause: L('第三方支付通道汇付通（ext-paygate）故障。', 'Outage at the third-party payment gateway HuiPay (ext-paygate).'),
        evidence: L('payment-svc 日志 call ext-paygate POST /v2/pay timeout after 5000ms、ext-paygate responded HTTP 503；payment-svc 最近一次发布是 09-18 的 v5.7.3，今天没有变更。处置：未做任何变更，已升级给汇付通值班，并在 #incident 频道和状态页发布状态通报，30 分钟后更新。', 'payment-svc logs call ext-paygate POST /v2/pay timeout after 5000ms and ext-paygate responded HTTP 503; payment-svc\'s last deploy was v5.7.3 on 09-18, no changes today. Remediation: no changes made; escalated to HuiPay on-call and posted a status update in #incident and on the status page, next update in 30 minutes.'),
      },
    },
  },
  {
    id: 'cert-expiry',
    title: L('证书过期：重启持有证书的服务', 'Expired certificate: restart the service that holds it'),
    core: true,
    root: { service: 'user-svc', category: 'cert_expiry' },
    allowed: ['user-svc'],
    evidence: ev([['x509', '证书', 'certificate', 'user-svc-tls']]),
    trap: L('报错在 gateway，但过期的是 user-svc 的服务端证书（user-svc-tls）。cert-manager 10:05 已经下发了新证书，user-svc 重启后才会加载。', 'The errors show up on gateway, but the expired cert is user-svc\'s server certificate (user-svc-tls). cert-manager issued a new one at 10:05; user-svc only picks it up after a restart.'),
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
        impact: L('10:00 起登录、个人中心接口失败，gateway 5xx 错误率约 15%。', 'Login and profile APIs failing since 10:00; gateway 5xx error rate around 15%.'),
        cause: L('user-svc 的 mTLS 服务端证书 user-svc-tls 在 10:00 过期；新证书 10:05 已下发，但进程只在启动时加载证书。', 'user-svc\'s mTLS server certificate user-svc-tls expired at 10:00; the new cert was issued at 10:05, but the process only loads certificates at startup.'),
        evidence: L('gateway 日志 upstream user-svc TLS handshake failed: x509: certificate has expired (cert=user-svc-tls notAfter=2026-09-20T10:00:00Z)；user-svc rps 从 1200 掉到 8；user-svc 变更记录 10:05 cert-manager 已续期 user-svc-tls，进程重启后生效。', 'gateway logs: upstream user-svc TLS handshake failed: x509: certificate has expired (cert=user-svc-tls notAfter=2026-09-20T10:00:00Z); user-svc rps dropped from 1200 to 8; user-svc change log at 10:05: cert-manager renewed user-svc-tls, takes effect after a restart.'),
      },
    },
  },

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  {
    id: 'cache-eviction',
    title: L('缓存驱逐风暴', 'Cache eviction storm'),
    core: false,
    root: { service: 'redis-main', category: 'cache_eviction' },
    allowed: ['redis-main'],
    evidence: ev([['maxmemory', 'cfg-42', '4gb'], ['驱逐', 'evict', '命中率', 'hit_rate']], [[], ['hit rate']]),
    trap: L('告警在 inventory-svc，根因是 redis-main 的 maxmemory 被改小；回滚配置，不要重启 redis。', 'The alert is on inventory-svc, but the root cause is redis-main\'s maxmemory being lowered; roll back the config, don\'t restart redis.'),
  },
  {
    id: 'noisy-neighbor',
    title: L('吵闹的邻居', 'Noisy neighbor'),
    core: false,
    root: { service: 'report-svc', category: 'noisy_neighbor' },
    allowed: ['report-svc', 'report.realtime_rebuild'],
    evidence: ev([['report.realtime_rebuild', 'report-svc'], ['cpu', 'pool-b', '节点池']], [[], ['node pool']]),
    trap: L('inventory-svc 的 CPU 打满但流量没变；同在 pool-b 的 report-svc 打开了实时重建批处理。', 'inventory-svc CPU is maxed but its traffic hasn\'t changed; report-svc, also on pool-b, turned on a real-time rebuild batch job.'),
  },
  {
    id: 'flag-misconfig',
    title: L('功能开关配错', 'Misconfigured feature flag'),
    core: false,
    root: { service: 'order-svc', category: 'config_error' },
    allowed: ['checkout.new_pricing'],
    evidence: ev([['checkout.new_pricing'], ['PricingEngineV2', '价格', '500', '错误率']], [[], ['pricing', 'error rate', 'error_rate']]),
    trap: L('没有发版，是 10:15 打开的 checkout.new_pricing 开关；关掉开关即可，回滚 order-svc 没用。', 'No deploy — it\'s the checkout.new_pricing flag turned on at 10:15. Turn the flag off; rolling back order-svc won\'t help.'),
  },
  {
    id: 'sms-outage',
    title: L('第三方短信平台故障', 'Third-party SMS platform outage'),
    core: false,
    root: { service: 'ext-sms', category: 'third_party_outage' },
    allowed: [],
    evidence: ev([['ext-sms', '云信', '短信'], ESCALATE], [['YunSMS', 'sms']]),
  },
  {
    id: 'user-deploy',
    title: L('登录失败：下游发布缺陷', 'Login failures: bad downstream deploy'),
    core: false,
    root: { service: 'user-svc', category: 'bad_deploy' },
    allowed: ['user-svc'],
    evidence: ev([['v4.3.0'], ['WRONGTYPE', '会话', 'session', '错误率']], [[], ['error rate', 'error_rate']]),
  },
  {
    id: 'inventory-hotfix',
    title: L('hotfix 也有问题：回滚到最后一个好版本', 'The hotfix is broken too: roll back to the last good version'),
    core: false,
    root: { service: 'inventory-svc', category: 'bad_deploy' },
    allowed: ['inventory-svc'],
    evidence: ev([['v3.2.0', 'v3.2.1'], ['OOM', '内存', 'mem']]),
    trap: L('v3.2.0 引入了内存泄漏，10:25 的 hotfix v3.2.1 没修好；要回滚到 v3.1.8，回滚到 v3.2.0 没用。', 'v3.2.0 introduced a memory leak and the 10:25 hotfix v3.2.1 didn\'t fix it; roll back to v3.1.8 — rolling back to v3.2.0 won\'t help.'),
  },
  {
    id: 'false-alarm-4xx',
    title: L('误报：压测流量的 4xx', 'False alarm: 4xx from load-test traffic'),
    core: false,
    root: { service: 'notification-svc', category: 'false_alarm' },
    allowed: [],
    evidence: ev([['400', '4xx', 'qa-loadtest', '压测', '客户端']], [['load test', 'load-test', 'client']]),
  },
  {
    id: 'db-failover',
    title: L('主库宕机：证据充分的故障切换', 'Primary DB down: a well-evidenced failover'),
    core: false,
    root: { service: 'mysql-orders', category: 'instance_failure' },
    allowed: ['mysql-orders'],
    evidence: ev([['mysql-orders-0', '主库', 'primary'], ['heartbeat', '心跳', '不可达', 'unreachable']]),
    trap: L('主库 mysql-orders-0 心跳丢失、从库健康且复制延迟为 0，自动切换被维护窗口关掉了。这是少数应该 failover 的情况，审批理由要写明证据。', 'Primary mysql-orders-0 lost its heartbeat, the replica is healthy with 0 replication lag, and auto-failover was disabled for a maintenance window. This is one of the few cases where you should fail over; the approval reason must state the evidence.'),
  },
  {
    id: 'payment-client-cert',
    title: L('看起来像第三方故障，其实是我方证书', 'Looks like a third-party outage, but it\'s our certificate'),
    core: false,
    root: { service: 'payment-svc', category: 'cert_expiry' },
    allowed: ['payment-svc'],
    evidence: ev([['payment-client.pem', '客户端证书', 'x509']], [['client cert']]),
    trap: L('报错指向 ext-paygate，但过期的是我方客户端证书 payment-client.pem；新证书已下发，重启 payment-svc 即可。', 'The errors point at ext-paygate, but the expired cert is our own client cert payment-client.pem; the new cert is already out, so just restart payment-svc.'),
  },
  {
    id: 'capacity-surge',
    title: L('流量突增：扩容', 'Traffic surge: scale out'),
    core: false,
    root: { service: 'order-svc', category: 'capacity' },
    allowed: ['order-svc'],
    evidence: ev([['rps', '流量', '大促', '推送'], ['cpu', '扩容', '副本']], [['traffic', 'flash sale', 'push'], ['scale', 'replica']]),
    trap: L('没有任何变更，流量翻了 3 倍、CPU 97%；需要把 order-svc 扩到至少 16 个副本。', 'No changes at all; traffic tripled and CPU is at 97%. Scale order-svc to at least 16 replicas.'),
  },
  {
    id: 'gateway-route',
    title: L('告警在网关，根因也在网关', 'Alert on the gateway, root cause also in the gateway'),
    core: false,
    root: { service: 'gateway', category: 'config_error' },
    allowed: ['gateway'],
    evidence: ev([['cfg-88', '路由'], ['404', '/api/coupons']], [['route', 'routing']]),
  },
  {
    id: 'gateway-cert',
    title: L('流量骤降：入口证书过期', 'Traffic drop: edge certificate expired'),
    core: false,
    root: { service: 'gateway', category: 'cert_expiry' },
    allowed: ['gateway'],
    evidence: ev([['api-qingcheng-tls', '证书', 'x509', 'certificate']]),
  },
  {
    id: 'disk-payment',
    title: L('磁盘写满：支付服务', 'Disk full: payment service'),
    core: false,
    root: { service: 'payment-svc', category: 'disk_full' },
    allowed: ['payment-svc', 'payment.trace_log'],
    evidence: ev([['磁盘', 'disk', 'No space'], ['payment.trace_log', 'trace']]),
  },
]

// —————————— 判定 ——————————

const SECTIONS: [string, string[]][] = L(
  [
    ['影响', ['影响']],
    ['根因', ['根因', '根本原因']],
    ['证据', ['证据', '依据']],
    ['处置', ['处置', '处理', '措施']],
  ],
  [
    ['Impact', ['impact', '影响']],
    ['Root cause', ['root cause', '根因']],
    ['Evidence', ['evidence', '证据']],
    ['Remediation', ['remediation', 'mitigation', 'resolution', 'action taken', 'actions taken', '处置']],
  ],
)
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const fmt = (a: { action: string; target: string; version?: string; replicas?: number; on?: boolean }) =>
  `${a.action}(${a.target}${a.version ? `, ${a.version}` : ''}${a.replicas !== undefined ? `, ${a.replicas}` : ''}${a.on !== undefined ? `, ${a.on}` : ''})`

export function checkOncall(spec: OncallTaskSpec, env: OncallEnv, output: unknown): CheckResult {
  const out = output as OncallOutput | undefined
  if (!out || typeof out !== 'object' || !out.rootCause || typeof out.rootCause.service !== 'string' || typeof out.rootCause.category !== 'string' || typeof out.summary !== 'string')
    return { pass: false, reason: L('返回值格式不对：应为 { rootCause: { service: string, category: string }, summary: string }', 'Wrong return shape: expected { rootCause: { service: string, category: string }, summary: string }') }
  const tip = spec.trap ? L(`（提示：${spec.trap}）`, ` (Hint: ${spec.trap})`) : ''

  const unapproved = env.actions.filter((a) => !a.approved)
  if (unapproved.length)
    return {
      pass: false,
      reason: L(
        `处置 ${unapproved.map(fmt).join('、')} 没有经过审批：每个处置之前都要先调用 requestApproval，拿到批准后才能执行（审批的 action 和对象要和实际执行的一致，一次审批只对应一次执行）。最可靠的做法是在处置工具里先审批、再执行。`,
        `${unapproved.map(fmt).join(', ')} ran without approval: call requestApproval before every remediation and only execute once it's approved (the approval's action and target must match what you run; one approval covers one execution). The most reliable way is to request approval inside the remediation tool, then execute.`,
      ),
    }

  const svc = norm(out.rootCause.service)
  const cat = norm(out.rootCause.category)
  if (svc !== norm(spec.root.service))
    return {
      pass: false,
      reason: L(
        `根因服务不对：应为 ${spec.root.service}，回答的是 ${out.rootCause.service || '（空）'}。${svc === norm(env.alert.service) ? '告警服务不一定是根因：沿依赖拓扑查下游 / 上游的指标和日志，找到“自己出错”的那个。' : ''}${tip}`,
        `Wrong root-cause service: expected ${spec.root.service}, got ${out.rootCause.service || '(empty)'}.${svc === norm(env.alert.service) ? " The alerting service isn't necessarily the root cause: follow the dependency topology and check downstream / upstream metrics and logs to find the service that is failing on its own." : ''}${tip}`,
      ),
    }
  if (cat !== spec.root.category)
    return {
      pass: false,
      reason: L(
        `根因类别不对：应为 ${spec.root.category}（${CATEGORIES[spec.root.category]}），回答的是 ${out.rootCause.category || '（空）'}${CATEGORIES[cat] ? '' : '（不在约定的枚举里）'}。${tip}`,
        `Wrong root-cause category: expected ${spec.root.category} (${CATEGORIES[spec.root.category]}), got ${out.rootCause.category || '(empty)'}${CATEGORIES[cat] ? '' : ' (not in the agreed enum)'}.${tip}`,
      ),
    }

  const extra = env.actions.filter((a) => !spec.allowed.includes(a.target))
  if (extra.length) {
    const none = !spec.allowed.length
    return {
      pass: false,
      reason: none
        ? L(
            `这次不应该做任何变更（${CATEGORIES[spec.root.category]}），却执行了 ${extra.map(fmt).join('、')}。${tip}`,
            `No changes should be made here (${CATEGORIES[spec.root.category]}), but you ran ${extra.map(fmt).join(', ')}.${tip}`,
          )
        : L(
            `执行了不必要的处置：${extra.map(fmt).join('、')}。处置要最小化，只针对根因（${spec.allowed.join(' / ')}），不要重启 / 回滚只是受影响的服务，更不要随意故障切换。${tip}`,
            `Unnecessary remediation: ${extra.map(fmt).join(', ')}. Keep remediation minimal and aimed at the root cause only (${spec.allowed.join(' / ')}): don't restart / roll back services that are merely affected, and never fail over casually.${tip}`,
          ),
    }
  }
  if (!env.healthy())
    return {
      pass: false,
      reason: L(
        `系统没有恢复：执行过的处置 ${env.actions.map(fmt).join('、') || '（无）'} 没有解决根因。${env.approvals.some((a) => !a.decision.approved) ? `有审批被驳回：${env.approvals.filter((a) => !a.decision.approved).map((a) => a.decision.comment).join('；').slice(0, 120)}。` : ''}${tip}`,
        `The system didn't recover: the remediation you ran (${env.actions.map(fmt).join(', ') || 'none'}) didn't fix the root cause.${env.approvals.some((a) => !a.decision.approved) ? ` Some approvals were rejected: ${env.approvals.filter((a) => !a.decision.approved).map((a) => a.decision.comment).join('; ').slice(0, 160)}.` : ''}${tip}`,
      ),
    }

  const text = norm(out.summary)
  const missing = SECTIONS.filter(([, ws]) => !ws.some((w) => text.includes(norm(w)))).map(([n]) => n)
  if (missing.length)
    return {
      pass: false,
      reason: L(
        `summary 应该是一份事后复盘，缺少：${missing.join('、')}。要求包含【影响】【根因】【证据】【处置】四部分。summary：“${out.summary.slice(0, 60)}”`,
        `summary should be a postmortem but is missing: ${missing.join(', ')}. It needs four sections: Impact, Root cause, Evidence, Remediation. summary: "${out.summary.slice(0, 80)}"`,
      ),
    }
  for (const group of spec.evidence)
    if (!group.some((w) => text.includes(norm(w))))
      return {
        pass: false,
        reason: L(
          `复盘里缺少关键证据：${group.slice(0, 6).join(' / ')}。证据要引用具体的版本号、日志原文、指标或开关名。${tip}`,
          `The postmortem is missing key evidence: ${group.filter((w) => !/[\u4e00-\u9fff]/.test(w)).slice(0, 6).join(' / ')}. Cite the specific version, log line, metric or flag name.${tip}`,
        ),
      }
  return {
    pass: true,
    reason: env.actions.length
      ? L(`根因正确，处置 ${env.actions.map(fmt).join('、')} 经审批执行，系统已恢复`, `Correct root cause; ${env.actions.map(fmt).join(', ')} ran with approval and the system recovered`)
      : L('根因正确，没有做多余的变更，复盘完整', 'Correct root cause, no unnecessary changes, complete postmortem'),
  }
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
