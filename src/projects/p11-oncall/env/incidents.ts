/**
 * P11 的故障注入：每个任务一个事故。事故 = 告警 + 指标变化 + 日志 + 当天的变更 + “怎样才算修好”。
 * 分钟下标：0 = 09:40，60 = 10:40（现在）。
 */
import { L } from '../../../engine/locale'
import type { Change, Metric } from './system'

export interface Alert {
  id: string
  service: string
  title: string
  severity: 'P1' | 'P2' | 'P3'
  firedAt: string
  description: string
}

export interface Effect {
  service: string
  metric: Metric
  from: number
  value: number
  shape?: 'step' | 'ramp' | 'spike'
  /** ramp：在这一分钟达到目标值 */
  rampTo?: number
  /** spike：最后一分钟 */
  until?: number
}

export interface LogRule {
  service: string
  from: number
  until?: number
  every: number
  level: 'ERROR' | 'WARN' | 'INFO'
  /** {n} 会被替换成一个确定的编号 */
  text: string
}

/** 已执行的处置 */
export interface Applied {
  action: 'rollback' | 'restart' | 'scale' | 'toggleFlag' | 'failover'
  target: string
  version?: string
  replicas?: number
  on?: boolean
  /** 执行时的分钟下标 */
  at: number
}

export interface Incident {
  id: string
  alert: Alert
  effects: Effect[]
  logs: LogRule[]
  /** 当天新增的变更（新的在前），按服务 */
  changes?: Record<string, Change[]>
  versions?: Record<string, string>
  replicas?: Record<string, number>
  flags?: Record<string, boolean>
  /** 根据已执行的处置判断系统是否恢复；没有这个函数 = 不需要我方处置 */
  fixed?(done: Applied[]): boolean
}

export const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h - 9) * 60 + m - 40
}
export const clock = (idx: number) => {
  const total = 9 * 60 + 40 + idx
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const today = (hhmm: string) => `2026-09-20 ${hhmm}`

const step = (service: string, metric: Metric, from: string, value: number): Effect => ({ service, metric, from: at(from), value })
const ramp = (service: string, metric: Metric, from: string, to: string, value: number): Effect => ({ service, metric, from: at(from), value, shape: 'ramp', rampTo: at(to) })
const spike = (service: string, metric: Metric, from: string, until: string, value: number): Effect => ({ service, metric, from: at(from), value, shape: 'spike', until: at(until) })
const log = (service: string, from: string, every: number, level: LogRule['level'], text: string, until?: string): LogRule => ({ service, from: at(from), every, level, text, until: until ? at(until) : undefined })

// —————————— “修好”的判定 ——————————
const rolledBack = (service: string, good: string[]) => (d: Applied[]) => d.some((a) => a.action === 'rollback' && a.target === service && good.includes(a.version ?? ''))
const restarted = (service: string) => (d: Applied[]) => d.some((a) => a.action === 'restart' && a.target === service)
const scaledTo = (service: string, ok: (n: number) => boolean) => (d: Applied[]) => {
  const last = d.filter((a) => a.action === 'scale' && a.target === service).pop()
  return !!last && ok(last.replicas ?? -1)
}
const flagOff = (name: string) => (d: Applied[]) => {
  const last = d.filter((a) => a.action === 'toggleFlag' && a.target === name).pop()
  return !!last && last.on === false
}
/** 先关日志开关，再重启（启动时清理旧日志）；顺序反了磁盘会再次写满 */
const flagOffThenRestart = (name: string, service: string) => (d: Applied[]) => {
  const off = d.findIndex((a) => a.action === 'toggleFlag' && a.target === name && a.on === false)
  return off >= 0 && d.slice(off + 1).some((a) => a.action === 'restart' && a.target === service) && flagOff(name)(d)
}
const failedOver = (cluster: string) => (d: Applied[]) => d.some((a) => a.action === 'failover' && a.target === cluster)

export const INCIDENTS: Incident[] = [
  // ———————————————— 核心 ————————————————
  {
    id: 'gateway-downstream-deploy',
    alert: { id: 'ALT-0955', service: 'gateway', title: L('gateway 5xx 错误率 > 5%', 'gateway 5xx error rate > 5%'), severity: 'P1', firedAt: '09:55', description: L('最近 5 分钟 gateway 5xx 错误率 12.1%（阈值 5%），下单接口受影响。', 'gateway 5xx error rate 12.1% over the last 5 minutes (threshold 5%); checkout API affected.') },
    effects: [
      step('payment-svc', 'error_rate', '09:52', 35),
      step('payment-svc', 'latency_p99', '09:52', 420),
      step('order-svc', 'error_rate', '09:52', 18),
      step('order-svc', 'latency_p99', '09:52', 380),
      step('gateway', 'error_rate', '09:52', 12),
    ],
    logs: [
      log('payment-svc', '09:52', 1, 'ERROR', 'NullPointerException at RiskScorer.score(RiskScorer.java:88) version=v5.8.0 orderId=O{n}'),
      log('order-svc', '09:52', 1, 'ERROR', 'call payment-svc POST /pay failed: HTTP 500 Internal Server Error orderId=O{n}'),
      log('gateway', '09:52', 1, 'ERROR', 'upstream order-svc returned 502 for POST /api/orders (trace={n})'),
    ],
    changes: { 'payment-svc': [{ time: today('09:52'), type: 'deploy', version: 'v5.8.0', summary: L('风控评分接入新模型', 'Risk scoring switched to the new model'), author: L('支付组-阿珍', 'payments/Jen') }] },
    versions: { 'payment-svc': 'v5.8.0' },
    fixed: rolledBack('payment-svc', ['v5.7.3', 'v5.7.2']),
  },
  {
    id: 'correlation-vs-cause',
    alert: { id: 'ALT-1011', service: 'inventory-svc', title: L('inventory-svc p99 延迟 > 1s', 'inventory-svc p99 latency > 1s'), severity: 'P2', firedAt: '10:11', description: L('最近 5 分钟 inventory-svc p99 延迟 1.8s（阈值 1s），错误率 22%。', 'inventory-svc p99 latency 1.8s over the last 5 minutes (threshold 1s), error rate 22%.') },
    effects: [
      step('order-svc', 'error_rate', '10:08', 6),
      step('order-svc', 'latency_p99', '10:08', 2100),
      step('inventory-svc', 'rps', '10:09', 4200),
      step('inventory-svc', 'latency_p99', '10:09', 1800),
      step('inventory-svc', 'error_rate', '10:09', 22),
      step('inventory-svc', 'cpu', '10:09', 92),
      step('gateway', 'error_rate', '10:09', 4),
    ],
    logs: [
      log('order-svc', '10:08', 1, 'WARN', 'reserveStock retry attempt=5/5 inventory-svc timeout after 2000ms (retryPolicy=aggressive) orderId=O{n}'),
      log('order-svc', '10:08', 2, 'ERROR', 'reserveStock failed after 5 retries orderId=O{n}'),
      log('inventory-svc', '10:09', 1, 'WARN', 'request queue full, rejecting request (rps=4120, top caller=order-svc)'),
      log('inventory-svc', '10:09', 2, 'ERROR', 'reserve timeout: queue wait 1800ms sku=S{n}'),
    ],
    changes: {
      'order-svc': [{ time: today('10:06'), type: 'deploy', version: 'v2.14.0', summary: L('库存预占失败时自动重试', 'Auto-retry failed stock reservations'), author: L('交易组-小周', 'trade/Joe') }],
      'inventory-svc': [{ time: today('10:20'), type: 'deploy', version: 'v3.2.0', summary: L('库存查询增加索引提示', 'Add index hint to stock queries'), author: L('交易组-大刘', 'trade/Liu') }],
    },
    versions: { 'order-svc': 'v2.14.0', 'inventory-svc': 'v3.2.0' },
    fixed: rolledBack('order-svc', ['v2.13.4', 'v2.13.3']),
  },
  {
    id: 'db-pool-minimal',
    alert: { id: 'ALT-1006', service: 'order-svc', title: L('order-svc 错误率 > 5%', 'order-svc error rate > 5%'), severity: 'P1', firedAt: '10:06', description: L('order-svc 错误率 9.2%，p99 3.1s；payment-svc 也有报错。', 'order-svc error rate 9.2%, p99 3.1s; payment-svc is erroring too.') },
    effects: [
      ramp('mysql-orders', 'connections', '10:00', '10:04', 500),
      step('mysql-orders', 'cpu', '10:00', 65),
      step('report-svc', 'connections', '10:00', 452),
      step('report-svc', 'rps', '10:00', 60),
      step('order-svc', 'error_rate', '10:04', 9),
      step('order-svc', 'latency_p99', '10:04', 3100),
      step('payment-svc', 'error_rate', '10:04', 7),
      step('inventory-svc', 'error_rate', '10:04', 5),
      step('user-svc', 'error_rate', '10:04', 3),
    ],
    logs: [
      log('mysql-orders', '10:04', 1, 'WARN', 'Too many connections (max_connections=500); connections by user: report_ro=452 order_rw=31 pay_rw=17'),
      log('order-svc', '10:04', 1, 'ERROR', 'HikariPool-1 - Connection is not available, request timed out after 3000ms'),
      log('payment-svc', '10:04', 2, 'ERROR', 'HikariPool-1 - Connection is not available, request timed out after 3000ms'),
      log('report-svc', '10:00', 3, 'INFO', 'realtime report worker started, db pool size=25 (replica {n})'),
    ],
    changes: { 'report-svc': [{ time: today('10:00'), type: 'scale', summary: L('scale 2 → 20（大促实时报表提速）', 'scale 2 → 20 (speed up real-time flash-sale reports)'), author: L('数据组-Sean', 'data/Sean') }] },
    replicas: { 'report-svc': 20 },
    fixed: scaledTo('report-svc', (n) => n <= 4),
  },
  {
    id: 'false-alarm',
    alert: { id: 'ALT-1031', service: 'gateway', title: L('gateway p99 延迟 > 800ms', 'gateway p99 latency > 800ms'), severity: 'P3', firedAt: '10:31', description: L('10:30 这一分钟 gateway p99 延迟 950ms（阈值 800ms）。', 'gateway p99 latency 950ms in the 10:30 minute (threshold 800ms).') },
    effects: [spike('gateway', 'latency_p99', '10:30', '10:30', 950)],
    logs: [log('gateway', '10:30', 1, 'WARN', 'slow request 1240ms GET /api/home/feed (cold cache after config reload)', '10:30')],
  },
  {
    id: 'disk-runbook',
    alert: { id: 'ALT-1017', service: 'order-svc', title: L('order-svc 错误率 > 5%', 'order-svc error rate > 5%'), severity: 'P1', firedAt: '10:17', description: L('order-svc 错误率 30%，下单失败。', 'order-svc error rate 30%, checkouts failing.') },
    effects: [
      ramp('order-svc', 'disk', '10:02', '10:15', 100),
      step('order-svc', 'error_rate', '10:15', 30),
      step('order-svc', 'latency_p99', '10:15', 900),
      step('gateway', 'error_rate', '10:15', 9),
    ],
    logs: [
      log('order-svc', '10:02', 3, 'WARN', 'DEBUG logging enabled (flag order.debug_log): dumping full payload for every request'),
      log('order-svc', '10:15', 1, 'ERROR', 'write /var/log/app/order.log failed: No space left on device'),
      log('gateway', '10:15', 1, 'ERROR', 'upstream order-svc returned 500 for POST /api/orders (trace={n})'),
    ],
    changes: { 'order-svc': [{ time: today('10:02'), type: 'flag', summary: L('order.debug_log: off → on（排查优惠券问题，临时打开 DEBUG 日志）', 'order.debug_log: off → on (temporary DEBUG logging to debug a coupon issue)'), author: L('交易组-老李', 'trade/Li') }] },
    flags: { 'order.debug_log': true },
    fixed: flagOffThenRestart('order.debug_log', 'order-svc'),
  },
  {
    id: 'third-party-escalate',
    alert: { id: 'ALT-1024', service: 'payment-svc', title: L('payment-svc 错误率 > 10%', 'payment-svc error rate > 10%'), severity: 'P1', firedAt: '10:24', description: L('payment-svc 错误率 61%，用户支付失败。', 'payment-svc error rate 61%, user payments failing.') },
    effects: [
      step('payment-svc', 'error_rate', '10:22', 61),
      step('payment-svc', 'latency_p99', '10:22', 5000),
      step('order-svc', 'error_rate', '10:22', 25),
      step('gateway', 'error_rate', '10:22', 8),
    ],
    logs: [
      log('payment-svc', '10:22', 1, 'ERROR', 'call ext-paygate POST /v2/pay timeout after 5000ms orderId=O{n}'),
      log('payment-svc', '10:22', 2, 'ERROR', 'ext-paygate responded HTTP 503 Service Unavailable (retry-after: 120)'),
      log('order-svc', '10:22', 1, 'ERROR', 'call payment-svc POST /pay failed: HTTP 502 (upstream ext-paygate unavailable)'),
    ],
  },
  {
    id: 'cert-expiry',
    alert: { id: 'ALT-1003', service: 'gateway', title: L('gateway 5xx 错误率 > 5%', 'gateway 5xx error rate > 5%'), severity: 'P1', firedAt: '10:03', description: L('登录、个人中心接口大量 502，gateway 5xx 错误率 15%。', 'Login and profile APIs returning lots of 502s; gateway 5xx error rate 15%.') },
    effects: [step('gateway', 'error_rate', '10:00', 15), step('user-svc', 'rps', '10:00', 8)],
    logs: [
      log('gateway', '10:00', 1, 'ERROR', 'upstream user-svc TLS handshake failed: x509: certificate has expired or is not yet valid (cert=user-svc-tls notAfter=2026-09-20T10:00:00Z)'),
      log('gateway', '10:00', 2, 'ERROR', 'upstream user-svc returned 502 for POST /api/login (trace={n})'),
    ],
    changes: { 'user-svc': [{ time: today('10:05'), type: 'cert', summary: L('cert-manager 已续期 user-svc-tls（新证书有效期至 2026-12-19），进程重启后生效', 'cert-manager renewed user-svc-tls (new cert valid until 2026-12-19); takes effect after a process restart'), author: 'cert-manager' }] },
    fixed: restarted('user-svc'),
  },

  // ———————————————— 完整集 ————————————————
  {
    id: 'cache-eviction',
    alert: { id: 'ALT-1014', service: 'inventory-svc', title: L('inventory-svc p99 延迟 > 800ms', 'inventory-svc p99 latency > 800ms'), severity: 'P2', firedAt: '10:14', description: L('inventory-svc p99 950ms，user-svc 也变慢了。', 'inventory-svc p99 950ms; user-svc has slowed down too.') },
    effects: [
      step('redis-main', 'evictions', '10:10', 52000),
      step('redis-main', 'hit_rate', '10:10', 41),
      step('redis-main', 'mem', '10:10', 100),
      step('inventory-svc', 'latency_p99', '10:11', 950),
      step('user-svc', 'latency_p99', '10:11', 600),
      step('mysql-orders', 'cpu', '10:11', 88),
      step('mysql-orders', 'latency_p99', '10:11', 120),
    ],
    logs: [
      log('redis-main', '10:10', 1, 'WARN', 'used_memory 4.00G reached maxmemory, evicted_keys +52k/min (allkeys-lru)'),
      log('inventory-svc', '10:11', 1, 'WARN', 'cache miss storm: hit_rate 41%, falling back to mysql-orders'),
    ],
    changes: { 'redis-main': [{ time: today('10:10'), type: 'config', version: 'cfg-42', summary: L('maxmemory 16gb → 4gb（成本优化）', 'maxmemory 16gb → 4gb (cost optimization)'), author: L('DBA-小黄', 'DBA/Huang') }] },
    fixed: rolledBack('redis-main', ['cfg-41']),
  },
  {
    id: 'noisy-neighbor',
    alert: { id: 'ALT-1009', service: 'inventory-svc', title: L('inventory-svc p99 延迟 > 1s', 'inventory-svc p99 latency > 1s'), severity: 'P2', firedAt: '10:09', description: L('inventory-svc p99 1.4s，CPU 99%，但流量没有变化。', 'inventory-svc p99 1.4s, CPU 99%, but traffic is unchanged.') },
    effects: [
      step('report-svc', 'cpu', '10:05', 96),
      step('inventory-svc', 'cpu', '10:06', 99),
      step('inventory-svc', 'latency_p99', '10:06', 1400),
      step('inventory-svc', 'error_rate', '10:06', 3),
    ],
    logs: [
      log('inventory-svc', '10:06', 1, 'WARN', 'cpu throttled 62% of periods (node pool pool-b)'),
      log('report-svc', '10:05', 2, 'INFO', 'realtime rebuild batch running: 1.2M rows/min (flag report.realtime_rebuild)'),
    ],
    changes: { 'report-svc': [{ time: today('10:05'), type: 'flag', summary: L('report.realtime_rebuild: off → on（大促看板实时重建）', 'report.realtime_rebuild: off → on (real-time rebuild for the flash-sale dashboard)'), author: L('数据组-Sean', 'data/Sean') }] },
    flags: { 'report.realtime_rebuild': true },
    fixed: (d) => flagOff('report.realtime_rebuild')(d) || scaledTo('report-svc', (n) => n <= 1)(d),
  },
  {
    id: 'flag-misconfig',
    alert: { id: 'ALT-1018', service: 'gateway', title: L('gateway 5xx 错误率 > 5%', 'gateway 5xx error rate > 5%'), severity: 'P1', firedAt: '10:18', description: L('下单确认接口大量 500，gateway 5xx 错误率 7%。', 'Order confirmation API returning lots of 500s; gateway 5xx error rate 7%.') },
    effects: [step('order-svc', 'error_rate', '10:15', 14), step('gateway', 'error_rate', '10:15', 7)],
    logs: [
      log('order-svc', '10:15', 1, 'ERROR', 'PricingEngineV2: missing price rule for region=HK sku=S{n} (flag checkout.new_pricing)'),
      log('gateway', '10:15', 1, 'ERROR', 'upstream order-svc returned 500 for POST /api/orders/confirm (trace={n})'),
    ],
    changes: { 'order-svc': [{ time: today('10:15'), type: 'flag', summary: L('checkout.new_pricing: off → on（新价格引擎灰度 100%）', 'checkout.new_pricing: off → on (new pricing engine rolled out to 100%)'), author: L('交易组-小周', 'trade/Joe') }] },
    flags: { 'checkout.new_pricing': true },
    fixed: flagOff('checkout.new_pricing'),
  },
  {
    id: 'sms-outage',
    alert: { id: 'ALT-1015', service: 'notification-svc', title: L('notification-svc 错误率 > 10%', 'notification-svc error rate > 10%'), severity: 'P2', firedAt: '10:15', description: L('notification-svc 错误率 48%，验证码短信发送失败。', 'notification-svc error rate 48%; verification-code SMS failing.') },
    effects: [step('notification-svc', 'error_rate', '10:12', 48), step('notification-svc', 'latency_p99', '10:12', 3000)],
    logs: [log('notification-svc', '10:12', 1, 'ERROR', 'send sms via ext-sms failed: connect timeout 3000ms (endpoint sms.yunxin.example) msgId=M{n}')],
  },
  {
    id: 'user-deploy',
    alert: { id: 'ALT-1008', service: 'gateway', title: L('gateway 5xx 错误率 > 5%', 'gateway 5xx error rate > 5%'), severity: 'P1', firedAt: '10:08', description: L('登录接口大量 500，gateway 5xx 错误率 10%。', 'Login API returning lots of 500s; gateway 5xx error rate 10%.') },
    effects: [step('user-svc', 'error_rate', '10:05', 40), step('gateway', 'error_rate', '10:05', 10)],
    logs: [
      log('user-svc', '10:05', 1, 'ERROR', 'SessionStore: WRONGTYPE Operation against a key holding the wrong kind of value (key=sess:v2:{n})'),
      log('gateway', '10:05', 1, 'ERROR', 'upstream user-svc returned 500 for POST /api/login (trace={n})'),
    ],
    changes: { 'user-svc': [{ time: today('10:05'), type: 'deploy', version: 'v4.3.0', summary: L('会话存储结构升级 v2', 'Session store schema upgrade to v2'), author: L('账号组-Kiki', 'accounts/Kiki') }] },
    versions: { 'user-svc': 'v4.3.0' },
    fixed: rolledBack('user-svc', ['v4.2.1', 'v4.2.0']),
  },
  {
    id: 'inventory-hotfix',
    alert: { id: 'ALT-1033', service: 'inventory-svc', title: L('inventory-svc 错误率 > 5%', 'inventory-svc error rate > 5%'), severity: 'P2', firedAt: '10:33', description: L('inventory-svc 实例反复重启，错误率 12%。10:25 已经发过一个 hotfix。', 'inventory-svc instances keep restarting, error rate 12%. A hotfix already went out at 10:25.') },
    effects: [
      ramp('inventory-svc', 'mem', '10:00', '10:10', 98),
      step('inventory-svc', 'error_rate', '10:10', 12),
      step('inventory-svc', 'latency_p99', '10:10', 1600),
    ],
    logs: [
      log('inventory-svc', '10:02', 2, 'WARN', 'SnapshotCache size growing: {n}MB (version=v3.2.x)'),
      log('inventory-svc', '10:10', 2, 'ERROR', 'container inventory-svc killed: OOMKilled (memory limit 2Gi), restarting'),
    ],
    changes: {
      'inventory-svc': [
        { time: today('10:25'), type: 'deploy', version: 'v3.2.1', summary: L('hotfix：SnapshotCache 内存问题', 'hotfix: SnapshotCache memory issue'), author: L('交易组-大刘', 'trade/Liu') },
        { time: today('10:00'), type: 'deploy', version: 'v3.2.0', summary: L('库存快照缓存', 'Stock snapshot cache'), author: L('交易组-大刘', 'trade/Liu') },
      ],
    },
    versions: { 'inventory-svc': 'v3.2.1' },
    fixed: rolledBack('inventory-svc', ['v3.1.8', 'v3.1.7']),
  },
  {
    id: 'false-alarm-4xx',
    alert: { id: 'ALT-1029', service: 'notification-svc', title: L('notification-svc 错误率 > 10%', 'notification-svc error rate > 10%'), severity: 'P3', firedAt: '10:29', description: L('10:28~10:30 notification-svc 错误率 14%。', 'notification-svc error rate 14% from 10:28 to 10:30.') },
    effects: [spike('notification-svc', 'error_rate', '10:28', '10:30', 14)],
    logs: [log('notification-svc', '10:28', 1, 'WARN', '400 Bad Request: invalid phone number format (source=qa-loadtest)', '10:30')],
  },
  {
    id: 'db-failover',
    alert: { id: 'ALT-1020', service: 'order-svc', title: L('order-svc 错误率 > 5%', 'order-svc error rate > 5%'), severity: 'P1', firedAt: '10:20', description: L('order-svc 错误率 30%，payment-svc、inventory-svc、user-svc 也在报错。', 'order-svc error rate 30%; payment-svc, inventory-svc and user-svc are erroring too.') },
    effects: [
      step('order-svc', 'error_rate', '10:18', 30),
      step('payment-svc', 'error_rate', '10:18', 25),
      step('inventory-svc', 'error_rate', '10:18', 20),
      step('user-svc', 'error_rate', '10:18', 15),
      step('mysql-orders', 'connections', '10:18', 0),
    ],
    logs: [
      log('mysql-orders', '10:18', 1, 'ERROR', 'orchestrator: primary mysql-orders-0 unreachable: heartbeat lost for 60s; replica mysql-orders-1 healthy, replication lag 0s; auto-failover disabled (maintenance window)'),
      log('order-svc', '10:18', 1, 'ERROR', 'Communications link failure: connect to mysql-orders-0:3306 timed out'),
    ],
    changes: { 'mysql-orders': [{ time: today('09:30'), type: 'config', summary: L('维护窗口：临时关闭自动故障切换', 'Maintenance window: auto-failover temporarily disabled'), author: L('DBA-老孟', 'DBA/Meng') }] },
    fixed: failedOver('mysql-orders'),
  },
  {
    id: 'payment-client-cert',
    alert: { id: 'ALT-1012', service: 'payment-svc', title: L('payment-svc 错误率 > 10%', 'payment-svc error rate > 10%'), severity: 'P1', firedAt: '10:12', description: L('payment-svc 错误率 70%，看起来像是支付通道挂了。', 'payment-svc error rate 70%; looks like the payment gateway is down.') },
    effects: [step('payment-svc', 'error_rate', '10:10', 70), step('order-svc', 'error_rate', '10:10', 28)],
    logs: [
      log('payment-svc', '10:10', 1, 'ERROR', 'call ext-paygate POST /v2/pay failed: TLS handshake: x509: certificate has expired (client cert payment-client.pem notAfter=2026-09-20T10:10:00Z)'),
      log('order-svc', '10:10', 1, 'ERROR', 'call payment-svc POST /pay failed: HTTP 502 orderId=O{n}'),
    ],
    changes: { 'payment-svc': [{ time: today('10:14'), type: 'cert', summary: L('cert-manager 已续期客户端证书 payment-client.pem，进程重启后生效', 'cert-manager renewed client cert payment-client.pem; takes effect after a process restart'), author: 'cert-manager' }] },
    fixed: restarted('payment-svc'),
  },
  {
    id: 'capacity-surge',
    alert: { id: 'ALT-1005', service: 'order-svc', title: L('order-svc p99 延迟 > 1s', 'order-svc p99 latency > 1s'), severity: 'P2', firedAt: '10:05', description: L('order-svc p99 2.6s；运营 10:00 推送了大促消息。', 'order-svc p99 2.6s; marketing sent a flash-sale push at 10:00.') },
    effects: [
      step('gateway', 'rps', '10:00', 7200),
      step('order-svc', 'rps', '10:00', 2400),
      step('order-svc', 'cpu', '10:00', 97),
      step('order-svc', 'latency_p99', '10:00', 2600),
      step('order-svc', 'error_rate', '10:02', 6),
    ],
    logs: [log('order-svc', '10:00', 1, 'WARN', 'request queue backlog {n}, worker pool saturated (8 replicas)')],
    fixed: scaledTo('order-svc', (n) => n >= 16),
  },
  {
    id: 'gateway-route',
    alert: { id: 'ALT-1022', service: 'gateway', title: L('gateway 错误率 > 5%', 'gateway error rate > 5%'), severity: 'P2', firedAt: '10:22', description: L('优惠券相关接口全部失败，gateway 错误率 9%。', 'All coupon APIs failing; gateway error rate 9%.') },
    effects: [step('gateway', 'error_rate', '10:20', 9)],
    logs: [log('gateway', '10:20', 1, 'WARN', 'no route matched: GET /api/coupons/available → 404 (trace={n})')],
    changes: { gateway: [{ time: today('10:20'), type: 'config', version: 'cfg-88', summary: L('路由表重构：合并营销路由', 'Routing table refactor: merge marketing routes'), author: L('平台组-阿飞', 'platform/Fei') }] },
    fixed: rolledBack('gateway', ['cfg-87']),
  },
  {
    id: 'gateway-cert',
    alert: { id: 'ALT-1033G', service: 'gateway', title: L('gateway 请求量下降 > 80%', 'gateway request volume down > 80%'), severity: 'P1', firedAt: '10:33', description: L('gateway rps 从 2400 跌到 300，但 5xx 没有升高。', 'gateway rps dropped from 2400 to 300, but 5xx did not go up.') },
    effects: [step('gateway', 'rps', '10:30', 300)],
    logs: [log('gateway', '10:30', 1, 'WARN', 'TLS handshake error from client: remote error: tls: bad certificate (server cert api-qingcheng-tls notAfter=2026-09-20T10:30:00Z expired)')],
    changes: { gateway: [{ time: today('10:31'), type: 'cert', summary: L('cert-manager 已续期 api-qingcheng-tls，进程重启后生效', 'cert-manager renewed api-qingcheng-tls; takes effect after a process restart'), author: 'cert-manager' }] },
    fixed: restarted('gateway'),
  },
  {
    id: 'disk-payment',
    alert: { id: 'ALT-1015P', service: 'payment-svc', title: L('payment-svc 错误率 > 10%', 'payment-svc error rate > 10%'), severity: 'P1', firedAt: '10:15', description: L('payment-svc 错误率 40%。', 'payment-svc error rate 40%.') },
    effects: [ramp('payment-svc', 'disk', '09:58', '10:13', 100), step('payment-svc', 'error_rate', '10:13', 40)],
    logs: [log('payment-svc', '10:13', 1, 'ERROR', 'append /var/log/app/trace.log failed: No space left on device')],
    changes: { 'payment-svc': [{ time: today('09:58'), type: 'flag', summary: L('payment.trace_log: off → on（排查对账差异）', 'payment.trace_log: off → on (investigating reconciliation mismatches)'), author: L('支付组-阿珍', 'payments/Jen') }] },
    flags: { 'payment.trace_log': true },
    fixed: flagOffThenRestart('payment.trace_log', 'payment-svc'),
  },
]
