/**
 * P11 的系统底座：青橙到家（本地生活平台）的微服务、依赖拓扑、指标基线、变更历史、功能开关和运维手册。
 * 时间轴：分钟下标 0 = 09:40，60 = 10:40（告警处理开始的“现在”）。日期都是 2026-09-20。
 */

export type Kind = 'service' | 'cache' | 'database' | 'external'
export type Metric = 'latency_p99' | 'error_rate' | 'cpu' | 'mem' | 'rps' | 'connections' | 'disk' | 'evictions' | 'hit_rate'

export interface ServiceInfo {
  name: string
  kind: Kind
  description: string
  owner: string
  replicas?: number
  version?: string
  /** 运行在哪个节点池（同一节点池的服务会争抢 CPU） */
  nodePool?: string
}

export const SERVICES: ServiceInfo[] = [
  { name: 'gateway', kind: 'service', description: 'API 网关：所有 App / 小程序流量的入口', owner: '平台组', replicas: 6, nodePool: 'pool-a' },
  { name: 'order-svc', kind: 'service', description: '订单服务：下单、订单查询', owner: '交易组', replicas: 8, nodePool: 'pool-a' },
  { name: 'payment-svc', kind: 'service', description: '支付服务：对接第三方支付通道', owner: '支付组', replicas: 6, nodePool: 'pool-a' },
  { name: 'inventory-svc', kind: 'service', description: '库存服务：库存查询与预占', owner: '交易组', replicas: 4, nodePool: 'pool-b' },
  { name: 'user-svc', kind: 'service', description: '用户服务：登录、用户资料（gateway 通过 mTLS 调用）', owner: '账号组', replicas: 4, nodePool: 'pool-a' },
  { name: 'notification-svc', kind: 'service', description: '通知服务：短信 / 推送', owner: '平台组', replicas: 3, nodePool: 'pool-a' },
  { name: 'report-svc', kind: 'service', description: '报表服务：运营报表、批处理任务', owner: '数据组', replicas: 2, nodePool: 'pool-b' },
  { name: 'redis-main', kind: 'cache', description: 'Redis 主缓存集群', owner: 'DBA', replicas: 3 },
  { name: 'mysql-orders', kind: 'database', description: 'MySQL 订单库（一主一从，max_connections=500）', owner: 'DBA', replicas: 2 },
  { name: 'ext-paygate', kind: 'external', description: '第三方：汇付通支付通道', owner: '外部供应商（汇付通）' },
  { name: 'ext-sms', kind: 'external', description: '第三方：云信短信平台', owner: '外部供应商（云信）' },
]

export const EDGES: [string, string][] = [
  ['gateway', 'order-svc'],
  ['gateway', 'user-svc'],
  ['gateway', 'inventory-svc'],
  ['order-svc', 'payment-svc'],
  ['order-svc', 'inventory-svc'],
  ['order-svc', 'mysql-orders'],
  ['order-svc', 'redis-main'],
  ['order-svc', 'notification-svc'],
  ['payment-svc', 'ext-paygate'],
  ['payment-svc', 'mysql-orders'],
  ['inventory-svc', 'redis-main'],
  ['inventory-svc', 'mysql-orders'],
  ['user-svc', 'redis-main'],
  ['user-svc', 'mysql-orders'],
  ['notification-svc', 'ext-sms'],
  ['report-svc', 'mysql-orders'],
]

export const METRICS_BY_KIND: Record<Exclude<Kind, 'external'>, Metric[]> = {
  service: ['latency_p99', 'error_rate', 'cpu', 'mem', 'rps', 'connections', 'disk'],
  cache: ['latency_p99', 'cpu', 'mem', 'connections', 'evictions', 'hit_rate'],
  database: ['latency_p99', 'cpu', 'mem', 'connections', 'disk'],
}

export const UNITS: Record<Metric, string> = {
  latency_p99: 'ms',
  error_rate: '%',
  cpu: '%',
  mem: '%',
  rps: 'req/s',
  connections: '个',
  disk: '%',
  evictions: '次/分钟',
  hit_rate: '%',
}

/** 指标基线（正常值）。服务的 connections 是数据库连接池里正在使用的连接数；mysql 的是总连接数。 */
export const BASELINE: Record<string, Partial<Record<Metric, number>>> = {
  gateway: { latency_p99: 180, error_rate: 0.2, cpu: 35, mem: 55, rps: 2400, connections: 0, disk: 40 },
  'order-svc': { latency_p99: 220, error_rate: 0.3, cpu: 45, mem: 60, rps: 800, connections: 30, disk: 45 },
  'payment-svc': { latency_p99: 260, error_rate: 0.3, cpu: 40, mem: 58, rps: 300, connections: 15, disk: 38 },
  'inventory-svc': { latency_p99: 90, error_rate: 0.1, cpu: 38, mem: 52, rps: 1000, connections: 20, disk: 35 },
  'user-svc': { latency_p99: 70, error_rate: 0.1, cpu: 30, mem: 50, rps: 1200, connections: 12, disk: 33 },
  'notification-svc': { latency_p99: 150, error_rate: 0.4, cpu: 20, mem: 45, rps: 150, connections: 0, disk: 30 },
  'report-svc': { latency_p99: 900, error_rate: 0.2, cpu: 25, mem: 60, rps: 5, connections: 50, disk: 42 },
  'redis-main': { latency_p99: 2, cpu: 30, mem: 55, connections: 600, evictions: 0, hit_rate: 97 },
  'mysql-orders': { latency_p99: 15, cpu: 35, mem: 70, connections: 180, disk: 61 },
}

export interface Change {
  time: string
  type: 'deploy' | 'config' | 'scale' | 'flag' | 'cert' | 'rollback' | 'restart' | 'failover'
  /** 发布 / 配置版本（可以用来回滚） */
  version?: string
  summary: string
  author: string
}

/** 各服务的历史变更（新的在前）。事故会在前面追加当天的变更。 */
export const BASE_CHANGES: Record<string, Change[]> = {
  gateway: [
    { time: '2026-09-19 16:20', type: 'deploy', version: 'v1.31.0', summary: '升级限流组件', author: '平台组-阿飞' },
    { time: '2026-09-15 11:02', type: 'config', version: 'cfg-87', summary: '路由表：新增 /api/coupons 路由', author: '平台组-阿飞' },
    { time: '2026-09-08 15:40', type: 'deploy', version: 'v1.30.2', summary: '修复 header 透传', author: '平台组-阿飞' },
  ],
  'order-svc': [
    { time: '2026-09-17 14:30', type: 'deploy', version: 'v2.13.4', summary: '订单列表分页优化', author: '交易组-小周' },
    { time: '2026-09-12 10:15', type: 'deploy', version: 'v2.13.3', summary: '修复优惠券叠加计算', author: '交易组-小周' },
  ],
  'payment-svc': [
    { time: '2026-09-18 15:10', type: 'deploy', version: 'v5.7.3', summary: '退款对账任务优化', author: '支付组-阿珍' },
    { time: '2026-09-15 11:45', type: 'deploy', version: 'v5.7.2', summary: '升级 SDK', author: '支付组-阿珍' },
  ],
  'inventory-svc': [
    { time: '2026-09-17 17:05', type: 'deploy', version: 'v3.1.8', summary: '库存预占接口限流', author: '交易组-大刘' },
    { time: '2026-09-10 16:20', type: 'deploy', version: 'v3.1.7', summary: '日志格式调整', author: '交易组-大刘' },
  ],
  'user-svc': [
    { time: '2026-09-16 10:40', type: 'deploy', version: 'v4.2.1', summary: '登录风控规则更新', author: '账号组-Kiki' },
    { time: '2026-09-09 14:00', type: 'deploy', version: 'v4.2.0', summary: '支持手机号一键登录', author: '账号组-Kiki' },
    { time: '2026-06-21 09:00', type: 'cert', summary: 'mTLS 服务端证书 user-svc-tls 签发（有效期 90 天，到期 2026-09-20 10:00）', author: 'cert-manager' },
  ],
  'notification-svc': [{ time: '2026-09-14 13:20', type: 'deploy', version: 'v1.9.2', summary: '短信模板变量校验', author: '平台组-阿飞' }],
  'report-svc': [{ time: '2026-09-11 18:00', type: 'deploy', version: 'v1.6.0', summary: '新增大促实时报表', author: '数据组-Sean' }],
  'redis-main': [{ time: '2026-09-01 02:00', type: 'config', version: 'cfg-41', summary: 'maxmemory 16gb，淘汰策略 allkeys-lru', author: 'DBA-老孟' }],
  'mysql-orders': [{ time: '2026-08-20 02:00', type: 'config', version: 'cfg-12', summary: 'max_connections=500', author: 'DBA-老孟' }],
}

export interface Flag {
  name: string
  owner: string
  on: boolean
  description: string
}

export const BASE_FLAGS: Flag[] = [
  { name: 'order.debug_log', owner: 'order-svc', on: false, description: '订单服务 DEBUG 级别日志' },
  { name: 'checkout.new_pricing', owner: 'order-svc', on: false, description: '新版价格引擎' },
  { name: 'payment.trace_log', owner: 'payment-svc', on: false, description: '支付服务全量请求追踪日志' },
  { name: 'report.realtime_rebuild', owner: 'report-svc', on: false, description: '报表实时重建（CPU 密集的批处理）' },
]

export const RUNBOOKS: { topic: string; keywords: string[]; text: string }[] = [
  {
    topic: '发布回滚',
    keywords: ['发布', '回滚', 'deploy', 'rollback', '版本', '5xx', '错误率'],
    text: `# 发布回滚
1. 用 getDeployHistory 查看出问题服务的变更；**变更时间必须早于异常开始时间**，晚于异常开始的变更不是原因。
2. 回滚到上一个稳定版本：rollback(service, 上一个稳定版本号)。如果之后还有过“修复”版本，同样有问题，就回到出问题之前的最后一个版本。
3. 只回滚根因服务。下游报错的服务、上游超时的服务不需要重启或回滚。
4. 回滚后观察 5 分钟错误率。`,
  },
  {
    topic: '数据库连接耗尽',
    keywords: ['数据库', '连接', 'connection', 'mysql', 'pool', '连接池', 'too many'],
    text: `# 数据库连接耗尽（mysql-orders max_connections=500）
1. getMetrics('mysql-orders', 'connections') 确认连接数是否打满。
2. searchLogs('mysql-orders', 'connections') 查看各账号的连接占用，找出占用异常的调用方服务。
3. 查该服务的变更历史（发布 / 扩缩容 / 开关），找出导致连接数暴涨的变更。
4. 处置：撤销那个变更（例如把副本数缩回原值：scale(service, 原副本数)）。
5. **不要**重启数据库、**不要**做主从切换（failover）：连接被占满不是实例故障，切换会造成 30 秒以上的写中断。也不要重启受影响的业务服务。`,
  },
  {
    topic: '磁盘写满（日志卷）',
    keywords: ['磁盘', 'disk', 'no space', '日志卷', '写满', 'space'],
    text: `# 磁盘写满（日志卷 /var/log/app）
1. getMetrics(service, 'disk') 确认是日志卷写满。
2. 查 getDeployHistory：通常是有人打开了 DEBUG / trace 日志开关（type=flag）。
3. 先关掉日志开关：toggleFlag(开关名, false)。
4. 再重启该服务：restart(service)。进程启动时会清理 /var/log/app 下的旧日志。
5. 顺序不能反：先重启、后关开关的话，日志洪水会在几分钟内再次写满磁盘。`,
  },
  {
    topic: '证书过期',
    keywords: ['证书', 'cert', 'x509', 'tls', 'ssl', 'handshake', '握手'],
    text: `# 证书过期
1. 日志里出现 "x509: certificate has expired" 时，先确认是**哪一方**的证书过期（服务端证书还是我方的客户端证书），看 notAfter 和证书名。
2. cert-manager 会提前自动续期并下发新证书，但服务进程只在启动时加载证书。查 getDeployHistory 里的 cert 记录确认新证书已下发。
3. 处置：重启**持有该证书**的服务：restart(service)。不要重启调用方。`,
  },
  {
    topic: '缓存驱逐风暴',
    keywords: ['缓存', 'redis', 'evict', '驱逐', '淘汰', 'hit_rate', '命中率', 'cache'],
    text: `# 缓存驱逐风暴（redis-main）
1. getMetrics('redis-main', 'evictions') 和 'hit_rate'：驱逐次数暴涨、命中率骤降，请求会穿透到数据库，下游服务延迟升高。
2. 查 redis-main 的变更历史：是否有人改了 maxmemory 等配置。
3. 处置：回滚配置 rollback('redis-main', 上一个配置版本)。**不要**重启 redis（会清空缓存，雪崩更严重）。`,
  },
  {
    topic: '吵闹的邻居（CPU 争抢）',
    keywords: ['cpu', '邻居', 'noisy', '节点池', 'node', '争抢', 'throttl'],
    text: `# 吵闹的邻居（CPU 争抢）
1. 受害服务 CPU 很高，但自身流量（rps）和发布都没有变化时，看 listServices 里的 nodePool，检查同一节点池的其他服务。
2. 找到 CPU 暴涨的那个服务，查它的变更历史（批处理开关、扩容……）。
3. 处置：关掉批处理开关（toggleFlag(开关, false)），或者把它缩回原副本数。不要扩容受害服务——节点池的 CPU 已经被吃满了。`,
  },
  {
    topic: '第三方依赖故障',
    keywords: ['第三方', '外部', 'external', 'ext-', '供应商', '汇付通', '云信', 'paygate', 'sms', '升级'],
    text: `# 第三方依赖故障（汇付通 ext-paygate / 云信 ext-sms）
1. 确认报错来自第三方：日志里是对 ext-* 的超时 / 503，且我方最近没有相关变更。
2. **不要做任何变更**：重启、回滚、扩容我方服务都解决不了第三方的问题，只会扩大影响。
3. 升级（escalate）：联系供应商值班（汇付通 400-820-xxxx / 云信工单），在 #incident 频道和状态页发布状态通报：影响范围、开始时间、正在联系供应商、下次更新时间。
4. 注意区分：如果日志是 "x509: certificate has expired" 并且过期的是**我方客户端证书**，那是我方问题，按《证书过期》处理。`,
  },
  {
    topic: '误报与告警抖动',
    keywords: ['误报', '抖动', 'flapping', '告警', '恢复', 'false'],
    text: `# 误报与告警抖动
1. 先看告警指标最近 30~60 分钟的曲线：只有一两个点越过阈值、之后已经恢复，并且错误日志没有增加，就是抖动。
2. 4xx 突增（客户端参数错误、压测流量）不是服务故障。
3. 处置：**不做任何变更**。在总结里写明判断依据，建议调整告警阈值或持续时间。`,
  },
  {
    topic: '主库故障切换',
    keywords: ['主库', 'primary', 'failover', '切换', '心跳', 'heartbeat', '宕机', 'unreachable'],
    text: `# 主库故障切换（mysql-orders）
1. 只有在**主库实例本身不可用**时才切换：mysql-orders 日志出现 "primary ... unreachable / heartbeat lost"，并且从库健康、复制延迟为 0。
2. 处置：failover('mysql-orders')。审批理由里必须写明主库不可达的证据和从库的复制延迟。
3. 连接数打满、慢查询都**不是**切换的理由。`,
  },
]
