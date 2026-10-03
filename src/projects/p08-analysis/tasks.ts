/**
 * P8 任务集：每个任务 = 一个分析问题 + 用可信代码算出的标准答案（DABench 的做法）。
 * 判定（与模型无关）：
 *   1. 答案在容差内等于标准答案；题目要求了小数位数时，格式也要符合；
 *   2. 至少用 runCode 执行过一次代码，并且返回的 code 就是执行过的代码之一（不许“目测”）；
 *   3. 可复现：在全新的沙箱里重新运行返回的 code，它的输出里要能找到这个答案。
 */
import { L } from '../../engine/locale'
import type { CheckResult, ProjectTask } from '../types'
import { clean, median, nps, pearson, percentile, round, std, sum, sumBy, withRevenue } from './clean'
import { datasets } from './env/data'
import type { AnalysisTaskEnv } from './env/index'
import { runInSandbox } from './env/sandbox'

export interface AnalysisAnswer {
  answer: number | string
  code: string
  explanation: string
}

export type Helper = 'num' | 'region' | 'platform' | 'city' | 'uniq'

/** 模拟模型对核心任务的“分析能力”：它会写这段代码，但清洗得干不干净，取决于它在上下文里看到了哪些脏数据 */
export interface MockSpec {
  dataset: 'sales' | 'events' | 'nps'
  /** 代码要用到的清洗工具（没看到对应的脏数据时，它们是“朴素”的实现） */
  helpers: Helper[]
  /** 分析代码的主体（最后打印 ANSWER: 值） */
  body: string
  /** 第一次一定会写错的地方：把 body 里的 find 换成 replace；报错信息里出现 error 后才会改正 */
  slip?: { find: string; replace: string; error: string }
  /** 没法运行代码时的“估计” */
  estimate: string
  /** 回答时的一句话说明 */
  explain: string
}

export interface AnalysisTaskDef {
  id: string
  title: string
  core: boolean
  kind: string
  question: string
  /** 标准答案（可信代码计算） */
  gold: () => number | string
  /** 数值题要求的小数位数（也是容差：±1 个最小单位） */
  decimals?: number
  /** 结果不对时给玩家的提示 */
  hint: string
  mock?: MockSpec
}

const t = (x: AnalysisTaskDef) => x
const inMonth = (m: string) => (r: { date: string }) => r.date.startsWith(m)
const q1 = (r: { date: string }) => r.date >= '2026-01-01' && r.date <= '2026-03-31'
const dailyRevenue = () => [...sumBy(withRevenue(clean().sales), (r) => r.date, (r) => r.revenue)]
const users = (rows: { user: string }[]) => new Set(rows.map((r) => r.user))
const validScores = () => clean().surveys.filter((s) => s.score !== null) as { city: string; score: number; channel: string; comment: string }[]
const WEEKDAYS = L(['周日', '周一', '周二', '周三', '周四', '周五', '周六'], ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])

const ZH_TASKS: AnalysisTaskDef[] = [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  t({
    id: 'east-q1-revenue',
    title: '华东一季度销售额',
    core: true,
    kind: '过滤 + 求和（地区写法、千分位、重复行）',
    question: '2026 年第一季度（1–3 月）华东地区的总销售额是多少元？保留两位小数。',
    gold: () => round(sum(withRevenue(clean().sales).filter((r) => r.region === L('华东', 'East') && q1(r)).map((r) => r.revenue)), 2),
    decimals: 2,
    hint: '华东有好几种写法（east / East / 华东区）；部分销售额带千分位逗号（parseFloat("12,345.60") 是 12）；有重复导入的行；缺失的销售额不计入。',
    mock: {
      dataset: 'sales',
      helpers: ['num', 'region', 'uniq'],
      body: `const rows = uniq(load('sales'))
let total = 0
for (const r of rows) {
  if (region(r.region) !== '华东' || r.date < '2026-01-01' || r.date > '2026-03-31') continue
  const v = num(r.revenue)
  if (v !== null) total += v
}
console.log('ANSWER:', round(total, 2))`,
      estimate: '大约 230 万元',
      explain: '筛选 2026 年 1–3 月、地区为华东的行，把销售额相加',
    },
  }),
  t({
    id: 'mom-growth',
    title: '环比增长率',
    core: true,
    kind: '分组 + 比率（千分位、重复行）',
    question: '2026 年 2 月全公司的销售额比 1 月增长了百分之多少？用百分数的数值作答（例如 -3.21 表示下降 3.21%），保留两位小数。',
    gold: () => {
      const m = sumBy(withRevenue(clean().sales), (r) => r.date.slice(0, 7), (r) => r.revenue)
      return round(((m.get('2026-02')! - m.get('2026-01')!) / m.get('2026-01')!) * 100, 2)
    },
    decimals: 2,
    hint: '先把每个月的销售额算对：千分位逗号要去掉、重复的行只算一次、缺失的不计入；再算 (2 月 − 1 月) / 1 月 × 100。',
    mock: {
      dataset: 'sales',
      helpers: ['num', 'uniq'],
      body: `const rows = uniq(load('sales'))
const month: Record<string, number> = {}
for (const r of rows) {
  const v = num(r.revenue)
  if (v === null) continue
  month[r.date.slice(0, 7)] = (month[r.date.slice(0, 7)] ?? 0) + v
}
console.log('1 月：', round(month['2026-01'], 2), '2 月：', round(month['2026-02'], 2))
console.log('ANSWER:', round(((month['2026-02'] - month['2026-01']) / month['2026-01']) * 100, 2))`,
      estimate: '大约 -5',
      explain: '按月汇总销售额，计算 (2 月 − 1 月) / 1 月 × 100',
    },
  }),
  t({
    id: 'median-daily-orders',
    title: '日订单数中位数',
    core: true,
    kind: '分组 + 中位数（重复行；第一次会写错）',
    question: '肉禽品类每天的订单数（当天所有地区相加）的中位数是多少？',
    gold: () => median([...sumBy(clean().sales.filter((r) => r.category === L('肉禽', 'Meat')), (r) => r.date, (r) => r.orders).values()]),
    hint: '先按天把肉禽的订单数相加（重复导入的行只算一次），再取中位数。',
    mock: {
      dataset: 'sales',
      helpers: ['num', 'uniq'],
      body: `const rows = uniq(load('sales'))
const byDay: Record<string, number> = {}
for (const r of rows) if (r.category === '肉禽') byDay[r.date] = (byDay[r.date] ?? 0) + (num(r.orders) ?? 0)
const values = Object.values(byDay).sort((a, b) => a - b)
const median = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2)
console.log('天数：', values.length)
console.log('ANSWER:', median(values))`,
      slip: {
        find: `const median = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2)\n`,
        replace: '',
        error: 'median is not defined',
      },
      estimate: '大约 300 单',
      explain: '按天汇总肉禽品类的订单数，再取中位数',
    },
  }),
  t({
    id: 'ios-pay-rate',
    title: 'iOS 支付转化率',
    core: true,
    kind: '去重计数 + 比率（平台写法）',
    question: 'iOS 用户的支付转化率是多少？（有 pay 事件的去重用户数 ÷ 有 view 事件的去重用户数，用百分数的数值作答，保留两位小数）',
    gold: () => {
      const ios = clean().events.filter((e) => e.platform === 'iOS')
      return round((users(ios.filter((e) => e.event === 'pay')).size / users(ios.filter((e) => e.event === 'view')).size) * 100, 2)
    },
    decimals: 2,
    hint: '平台字段有 iOS / ios / IOS 几种写法，要先统一；用户数按 user_id 去重。',
    mock: {
      dataset: 'events',
      helpers: ['platform', 'uniq'],
      body: `const rows = uniq(load('events'), (r) => r.event_id)
const viewed = new Set<string>()
const paid = new Set<string>()
for (const r of rows) {
  if (platform(r.platform) !== 'iOS') continue
  if (r.event === 'view') viewed.add(r.user_id)
  if (r.event === 'pay') paid.add(r.user_id)
}
console.log('iOS 浏览用户：', viewed.size, '支付用户：', paid.size)
console.log('ANSWER:', round((paid.size / viewed.size) * 100, 2))`,
      estimate: '大约 30',
      explain: '统一平台写法后，用支付的去重用户数除以浏览的去重用户数',
    },
  }),
  t({
    id: 'avg-view-seconds',
    title: '平均停留时长',
    core: true,
    kind: '均值（缺失值、重复上报）',
    question: 'view 事件的平均停留时长是多少秒？保留两位小数。',
    gold: () => {
      const xs = clean().events.filter((e) => e.event === 'view' && e.durationMs !== null).map((e) => e.durationMs! / 1000)
      return round(sum(xs) / xs.length, 2)
    },
    decimals: 2,
    hint: '停留时长缺失的 view 不计入平均（不能当成 0）；同一个 event_id 重复上报的只算一次；毫秒换算成秒。',
    mock: {
      dataset: 'events',
      helpers: ['num', 'uniq'],
      body: `const rows = uniq(load('events'), (r) => r.event_id)
const secs: number[] = []
for (const r of rows) {
  if (r.event !== 'view') continue
  const v = num(r.duration_ms)
  if (v !== null) secs.push(v / 1000)
}
console.log('有效样本：', secs.length)
console.log('ANSWER:', round(secs.reduce((a, b) => a + b, 0) / secs.length, 2))`,
      estimate: '大约 30 秒',
      explain: '取 view 事件的停留时长（毫秒换算成秒）求平均',
    },
  }),
  t({
    id: 'nps-overall',
    title: '整体 NPS',
    core: true,
    kind: '指标计算（无效评分、重复提交）',
    question: '这次调研的 NPS 是多少？（推荐者 9–10 分占比减去贬损者 0–6 分占比，再乘以 100；无效评分不计入；保留一位小数）',
    gold: () => round(nps(validScores().map((s) => s.score)), 1),
    decimals: 1,
    hint: "评分里有 'N/A' 和空值，它们是无效问卷，不能当成 0 分；同一个 resp_id 重复提交的只算一次。",
    mock: {
      dataset: 'nps',
      helpers: ['num', 'uniq'],
      body: `const rows = uniq(load('nps'), (r) => r.resp_id)
let n = 0
let pro = 0
let det = 0
for (const r of rows) {
  const s = num(r.score)
  if (s === null || s < 0 || s > 10) continue
  n++
  if (s >= 9) pro++
  else if (s <= 6) det++
}
console.log('有效问卷：', n, '推荐者：', pro, '贬损者：', det)
console.log('ANSWER:', round(((pro - det) / n) * 100, 1))`,
      estimate: '大约 35',
      explain: '有效问卷中推荐者占比减去贬损者占比，再乘以 100',
    },
  }),
  t({
    id: 'top-region-feb',
    title: '2 月销冠地区',
    core: true,
    kind: '分类答案（地区写法）',
    question: '2026 年 2 月销售额最高的是哪个地区？只回答地区名。',
    gold: () => [...sumBy(withRevenue(clean().sales).filter(inMonth('2026-02')), (r) => r.region, (r) => r.revenue)].sort((a, b) => b[1] - a[1])[0][0],
    hint: '同一个地区有好几种写法（华东 / east / East / 华东区），不合并的话销售额会被拆散。',
    mock: {
      dataset: 'sales',
      helpers: ['num', 'region', 'uniq'],
      body: `const rows = uniq(load('sales'))
const total: Record<string, number> = {}
for (const r of rows) {
  if (!r.date.startsWith('2026-02')) continue
  const v = num(r.revenue)
  if (v === null) continue
  total[region(r.region)] = (total[region(r.region)] ?? 0) + v
}
const ranked = Object.entries(total).sort((a, b) => b[1] - a[1])
console.log(ranked.map(([k, v]) => \`\${k}：\${round(v, 2)}\`).join('\\n'))
console.log('ANSWER:', ranked[0][0])`,
      estimate: '华南',
      explain: '按地区汇总 2 月的销售额，取最高的地区',
    },
  }),
  t({
    id: 'weekly-users',
    title: '首周使用人数',
    core: true,
    kind: '去重计数（干净的题）',
    question: '3 月 1 日到 3 月 7 日（含）一共有多少个不同的用户用过 App？',
    gold: () => users(clean().events.filter((e) => e.ts >= '2026-03-01' && e.ts < '2026-03-08')).size,
    hint: '按 user_id 去重计数，时间范围是 2026-03-01 00:00 到 2026-03-07 23:59。',
    mock: {
      dataset: 'events',
      helpers: [],
      body: `const rows = load('events')
const ids = new Set(rows.filter((r) => r.ts >= '2026-03-01' && r.ts < '2026-03-08').map((r) => r.user_id))
console.log('ANSWER:', ids.size)`,
      estimate: '大约 120 人',
      explain: '筛选 3 月 1 日至 7 日的事件，按 user_id 去重计数',
    },
  }),

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  t({
    id: 'refund-ratio-mar',
    title: '3 月退款占比',
    core: false,
    kind: '比率',
    question: '2026 年 3 月的退款金额占销售额的百分之多少？用百分数的数值作答，保留两位小数。',
    gold: () => {
      const rows = withRevenue(clean().sales).filter(inMonth('2026-03'))
      return round((sum(rows.map((r) => r.refund ?? 0)) / sum(rows.map((r) => r.revenue))) * 100, 2)
    },
    decimals: 2,
    hint: '退款和销售额都要去掉千分位逗号、去重；销售额缺失的行不计入。',
  }),
  t({
    id: 'p90-daily-revenue',
    title: '日销售额 P90',
    core: false,
    kind: '分位数',
    question: '全公司日销售额（每天所有地区、品类相加）的 90 分位数是多少？按线性插值计算（与 numpy.percentile 的默认方法一致），保留两位小数。',
    gold: () => round(percentile(dailyRevenue().map(([, v]) => v), 90), 2),
    decimals: 2,
    hint: '先按天汇总，再用线性插值：位置 = 0.9 × (n − 1)。',
  }),
  t({
    id: 'best-weekday',
    title: '最旺的星期几',
    core: false,
    kind: '分类答案（日期处理）',
    question: '一周里哪一天的平均日销售额最高？回答“周一”到“周日”之一。',
    gold: () => {
      const by = new Map<string, number[]>()
      for (const [date, v] of dailyRevenue()) {
        const w = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
        by.set(w, [...(by.get(w) ?? []), v])
      }
      return [...by].map(([w, xs]) => [w, sum(xs) / xs.length] as const).sort((a, b) => b[1] - a[1])[0][0]
    },
    hint: '先按天汇总，再按星期几求平均（注意 new Date("2026-03-01") 的时区问题）。',
  }),
  t({
    id: 'veg-share-q1',
    title: '蔬果占比',
    core: false,
    kind: '占比',
    question: '2026 年第一季度，蔬果品类的销售额占全部销售额的百分之多少？保留两位小数。',
    gold: () => {
      const rows = withRevenue(clean().sales).filter(q1)
      return round((sum(rows.filter((r) => r.category === L('蔬果', 'Produce')).map((r) => r.revenue)) / sum(rows.map((r) => r.revenue))) * 100, 2)
    },
    decimals: 2,
    hint: '分子分母都要先清洗（千分位、重复行、缺失值）。',
  }),
  t({
    id: 'std-daily-mar',
    title: '日销售额波动',
    core: false,
    kind: '标准差',
    question: '2026 年 3 月全公司日销售额的总体标准差是多少？保留两位小数。',
    gold: () => round(std(dailyRevenue().filter(([d]) => d.startsWith('2026-03')).map(([, v]) => v)), 2),
    decimals: 2,
    hint: '总体标准差除以 n（不是 n − 1）；先按天汇总。',
  }),
  t({
    id: 'corr-orders-revenue',
    title: '订单数与销售额的相关性',
    core: false,
    kind: '相关系数',
    question: '按天汇总后，全公司日订单数和日销售额的皮尔逊相关系数是多少？销售额缺失的行整行不计入。保留三位小数。',
    gold: () => {
      const rows = withRevenue(clean().sales)
      const o = sumBy(rows, (r) => r.date, (r) => r.orders)
      const v = sumBy(rows, (r) => r.date, (r) => r.revenue)
      const days = [...o.keys()]
      return round(pearson(days.map((d) => o.get(d)!), days.map((d) => v.get(d)!)), 3)
    },
    decimals: 3,
    hint: '先剔除销售额缺失的行，再按天汇总订单数和销售额，最后算皮尔逊相关系数。',
  }),
  t({
    id: 'missing-revenue-rows',
    title: '缺失的销售额',
    core: false,
    kind: '数据质量',
    question: '销售数据去重后，有多少行的销售额是缺失的？',
    gold: () => clean().sales.filter((r) => r.revenue === null).length,
    hint: '先去掉完全重复的行，再数 revenue 为空的行。',
  }),
  t({
    id: 'duplicate-rows',
    title: '重复导入的行',
    core: false,
    kind: '数据质量',
    question: '销售数据里有多少行是重复导入的多余行？（同一行出现 3 次算 2 行多余）',
    gold: () => clean().salesRaw - clean().sales.length,
    hint: '多余行数 = 总行数 − 去重后的行数（按整行比较）。',
  }),
  t({
    id: 'top3-payers',
    title: '支付次数 Top 3',
    core: false,
    kind: 'Top-k + 并列规则',
    question: '支付次数（pay 事件）最多的 3 个用户是谁？按次数从多到少，次数相同按 user_id 升序，用英文逗号分隔作答，例如 u001,u002,u003。',
    gold: () =>
      [...sumBy(clean().events.filter((e) => e.event === 'pay'), (e) => e.user, () => 1)]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 3)
        .map(([u]) => u)
        .join(','),
    hint: '同一个 event_id 重复上报的只算一次；次数并列时按 user_id 升序。',
  }),
  t({
    id: 'cart-to-checkout',
    title: '加购到下单',
    core: false,
    kind: '漏斗',
    question: '有加购（add_cart）行为的用户中，有百分之多少也下过单（checkout）？按去重用户计算，保留两位小数。',
    gold: () => {
      const ev = clean().events
      const cart = users(ev.filter((e) => e.event === 'add_cart'))
      const co = users(ev.filter((e) => e.event === 'checkout'))
      return round(([...cart].filter((u) => co.has(u)).length / cart.size) * 100, 2)
    },
    decimals: 2,
    hint: '分母是加购过的去重用户，分子是其中也下过单的用户。',
  }),
  t({
    id: 'android-share',
    title: 'Android 事件占比',
    core: false,
    kind: '占比（平台写法、去重）',
    question: '所有事件中，Android 平台的事件占百分之多少？保留两位小数。',
    gold: () => round((clean().events.filter((e) => e.platform === 'Android').length / clean().events.length) * 100, 2),
    decimals: 2,
    hint: 'Android / android 要合并；重复上报的事件只算一次。',
  }),
  t({
    id: 'peak-dau-day',
    title: '日活最高的一天',
    core: false,
    kind: '分类答案（日期）',
    question: '3 月哪一天的日活跃用户数（当天有任意事件的去重用户数）最多？如有并列回答最早的一天，格式 YYYY-MM-DD。',
    gold: () => {
      const by = new Map<string, Set<string>>()
      for (const e of clean().events) by.set(e.ts.slice(0, 10), (by.get(e.ts.slice(0, 10)) ?? new Set()).add(e.user))
      return [...by].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))[0][0]
    },
    hint: '按日期分组，统计去重的 user_id。',
  }),
  t({
    id: 'shanghai-nps',
    title: '上海 NPS',
    core: false,
    kind: '分组指标（城市写法）',
    question: '上海用户的 NPS 是多少？（口径同整体 NPS，保留一位小数）',
    gold: () => round(nps(validScores().filter((s) => s.city === L('上海', 'Shanghai')).map((s) => s.score)), 1),
    decimals: 1,
    hint: '上海有好几种写法（上海 / 上海市 / Shanghai / shanghai）；无效评分不计入。',
  }),
  t({
    id: 'delivery-complaints',
    title: '配送吐槽',
    core: false,
    kind: '文本过滤',
    question: '贬损者（0–6 分）的评论里，提到“配送”的有多少条？',
    gold: () => validScores().filter((s) => s.score <= 6 && L(s.comment.includes('配送'), /delivery/i.test(s.comment))).length,
    hint: '评论里有逗号和引号，要用正确的 CSV 解析；评分无效的不算贬损者；重复提交只算一次。',
  }),
  t({
    id: 'promoter-share-app',
    title: 'App 渠道推荐者占比',
    core: false,
    kind: '分组占比',
    question: '通过 App 渠道提交的有效问卷里，推荐者（9–10 分）占百分之多少？保留两位小数。',
    gold: () => {
      const app = validScores().filter((s) => s.channel === 'App')
      return round((app.filter((s) => s.score >= 9).length / app.length) * 100, 2)
    },
    decimals: 2,
    hint: '只看 channel 为 App 的有效问卷（评分有效、按 resp_id 去重）。',
  }),
]

/** English text for each task (gold answers are shared; text values in the data are translated in env/data.ts) */
type EnTask = Pick<AnalysisTaskDef, 'title' | 'kind' | 'question' | 'hint'> & { mock?: Partial<MockSpec> }

const EN_TASKS: Record<string, EnTask> = {
  // ———————————————— core ————————————————
  'east-q1-revenue': {
    title: 'East region Q1 revenue',
    kind: 'Filter + sum (region spellings, thousands separators, duplicate rows)',
    question: 'What was the total revenue (¥) of the East region in Q1 2026 (January–March)? Round to two decimal places.',
    hint: 'East is spelled several ways (east / EAST / East Region); some revenue values have thousands separators (parseFloat("12,345.60") is 12); some rows were imported twice; missing revenue is excluded.',
    mock: {
      body: `const rows = uniq(load('sales'))
let total = 0
for (const r of rows) {
  if (region(r.region) !== 'East' || r.date < '2026-01-01' || r.date > '2026-03-31') continue
  const v = num(r.revenue)
  if (v !== null) total += v
}
console.log('ANSWER:', round(total, 2))`,
      estimate: 'about ¥2.3 million',
      explain: 'filter rows from January–March 2026 in the East region and sum the revenue',
    },
  },
  'mom-growth': {
    title: 'Month-over-month growth',
    kind: 'Group + ratio (thousands separators, duplicate rows)',
    question:
      'By what percentage did company-wide revenue change in February 2026 compared with January? Answer with the percentage as a number (e.g. -3.21 means a 3.21% drop), rounded to two decimal places.',
    hint: "Get each month's revenue right first: strip thousands separators, count duplicate rows once, skip missing values; then compute (Feb − Jan) / Jan × 100.",
    mock: {
      body: `const rows = uniq(load('sales'))
const month: Record<string, number> = {}
for (const r of rows) {
  const v = num(r.revenue)
  if (v === null) continue
  month[r.date.slice(0, 7)] = (month[r.date.slice(0, 7)] ?? 0) + v
}
console.log('Jan:', round(month['2026-01'], 2), 'Feb:', round(month['2026-02'], 2))
console.log('ANSWER:', round(((month['2026-02'] - month['2026-01']) / month['2026-01']) * 100, 2))`,
      estimate: 'about -5',
      explain: 'sum revenue by month and compute (Feb − Jan) / Jan × 100',
    },
  },
  'median-daily-orders': {
    title: 'Median daily orders',
    kind: 'Group + median (duplicate rows; the first attempt has a bug)',
    question: 'What is the median number of daily orders in the Meat category (all regions added up per day)?',
    hint: 'First add up Meat orders per day (count duplicate rows once), then take the median.',
    mock: {
      body: `const rows = uniq(load('sales'))
const byDay: Record<string, number> = {}
for (const r of rows) if (r.category === 'Meat') byDay[r.date] = (byDay[r.date] ?? 0) + (num(r.orders) ?? 0)
const values = Object.values(byDay).sort((a, b) => a - b)
const median = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2)
console.log('days:', values.length)
console.log('ANSWER:', median(values))`,
      estimate: 'about 300 orders',
      explain: 'sum Meat orders per day, then take the median',
    },
  },
  'ios-pay-rate': {
    title: 'iOS payment conversion',
    kind: 'Distinct count + ratio (platform spellings)',
    question:
      'What is the payment conversion rate of iOS users? (distinct users with a pay event ÷ distinct users with a view event, as a percentage number, rounded to two decimal places)',
    hint: 'The platform field is spelled iOS / ios / IOS; normalize it first. Count users distinct by user_id.',
    mock: {
      body: `const rows = uniq(load('events'), (r) => r.event_id)
const viewed = new Set<string>()
const paid = new Set<string>()
for (const r of rows) {
  if (platform(r.platform) !== 'iOS') continue
  if (r.event === 'view') viewed.add(r.user_id)
  if (r.event === 'pay') paid.add(r.user_id)
}
console.log('iOS viewers:', viewed.size, 'payers:', paid.size)
console.log('ANSWER:', round((paid.size / viewed.size) * 100, 2))`,
      estimate: 'about 30',
      explain: 'normalize the platform spelling, then divide distinct paying users by distinct viewing users',
    },
  },
  'avg-view-seconds': {
    title: 'Average view time',
    kind: 'Mean (missing values, duplicate events)',
    question: 'What is the average time spent on a view event, in seconds? Round to two decimal places.',
    hint: "Views without a duration don't count toward the average (they are not 0); events reported twice with the same event_id count once; convert milliseconds to seconds.",
    mock: {
      body: `const rows = uniq(load('events'), (r) => r.event_id)
const secs: number[] = []
for (const r of rows) {
  if (r.event !== 'view') continue
  const v = num(r.duration_ms)
  if (v !== null) secs.push(v / 1000)
}
console.log('samples:', secs.length)
console.log('ANSWER:', round(secs.reduce((a, b) => a + b, 0) / secs.length, 2))`,
      estimate: 'about 30 seconds',
      explain: 'average the view durations (milliseconds converted to seconds)',
    },
  },
  'nps-overall': {
    title: 'Overall NPS',
    kind: 'Metric (invalid scores, repeat submissions)',
    question:
      "What is this survey's NPS? (share of promoters scoring 9–10 minus share of detractors scoring 0–6, times 100; invalid scores don't count; round to one decimal place)",
    hint: "Scores include 'N/A' and blanks: those responses are invalid and must not count as 0; responses submitted twice with the same resp_id count once.",
    mock: {
      body: `const rows = uniq(load('nps'), (r) => r.resp_id)
let n = 0
let pro = 0
let det = 0
for (const r of rows) {
  const s = num(r.score)
  if (s === null || s < 0 || s > 10) continue
  n++
  if (s >= 9) pro++
  else if (s <= 6) det++
}
console.log('valid:', n, 'promoters:', pro, 'detractors:', det)
console.log('ANSWER:', round(((pro - det) / n) * 100, 1))`,
      estimate: 'about 35',
      explain: 'take the promoter share minus the detractor share among valid responses, times 100',
    },
  },
  'top-region-feb': {
    title: 'Top region in February',
    kind: 'Categorical answer (region spellings)',
    question: 'Which region had the highest revenue in February 2026? Answer with the region name only.',
    hint: "The same region is spelled several ways (East / east / EAST / East Region); if you don't merge them, its revenue gets split up.",
    mock: {
      body: `const rows = uniq(load('sales'))
const total: Record<string, number> = {}
for (const r of rows) {
  if (!r.date.startsWith('2026-02')) continue
  const v = num(r.revenue)
  if (v === null) continue
  total[region(r.region)] = (total[region(r.region)] ?? 0) + v
}
const ranked = Object.entries(total).sort((a, b) => b[1] - a[1])
console.log(ranked.map(([k, v]) => \`\${k}: \${round(v, 2)}\`).join('\\n'))
console.log('ANSWER:', ranked[0][0])`,
      estimate: 'South',
      explain: 'sum February revenue by region and take the highest',
    },
  },
  'weekly-users': {
    title: 'First-week users',
    kind: 'Distinct count (a clean one)',
    question: 'How many distinct users used the app from March 1 to March 7 (inclusive)?',
    hint: 'Count distinct user_id; the range is 2026-03-01 00:00 to 2026-03-07 23:59.',
    mock: {
      body: `const rows = load('events')
const ids = new Set(rows.filter((r) => r.ts >= '2026-03-01' && r.ts < '2026-03-08').map((r) => r.user_id))
console.log('ANSWER:', ids.size)`,
      estimate: 'about 120 users',
      explain: 'filter events from March 1–7 and count distinct user_id',
    },
  },

  // ———————————————— full set ————————————————
  'refund-ratio-mar': {
    title: 'March refund ratio',
    kind: 'Ratio',
    question: 'In March 2026, refunds were what percentage of revenue? Answer with the percentage as a number, rounded to two decimal places.',
    hint: 'Strip thousands separators and deduplicate for both refunds and revenue; skip rows with missing revenue.',
  },
  'p90-daily-revenue': {
    title: 'Daily revenue P90',
    kind: 'Percentile',
    question:
      'What is the 90th percentile of company-wide daily revenue (all regions and categories added up per day)? Use linear interpolation (the numpy.percentile default) and round to two decimal places.',
    hint: 'Sum by day first, then interpolate linearly: position = 0.9 × (n − 1).',
  },
  'best-weekday': {
    title: 'Busiest weekday',
    kind: 'Categorical answer (date handling)',
    question: 'Which day of the week has the highest average daily revenue? Answer with one of "Monday" to "Sunday".',
    hint: 'Sum by day first, then average by weekday (watch out for time zones with new Date("2026-03-01")).',
  },
  'veg-share-q1': {
    title: 'Produce share',
    kind: 'Share',
    question: 'In Q1 2026, what percentage of total revenue came from the Produce category? Round to two decimal places.',
    hint: 'Clean both the numerator and the denominator first (thousands separators, duplicate rows, missing values).',
  },
  'std-daily-mar': {
    title: 'Daily revenue volatility',
    kind: 'Standard deviation',
    question: 'What is the population standard deviation of company-wide daily revenue in March 2026? Round to two decimal places.',
    hint: 'Population standard deviation divides by n (not n − 1); sum by day first.',
  },
  'corr-orders-revenue': {
    title: 'Orders vs. revenue correlation',
    kind: 'Correlation',
    question:
      'After summing by day, what is the Pearson correlation between company-wide daily orders and daily revenue? Drop rows with missing revenue entirely. Round to three decimal places.',
    hint: 'Drop rows with missing revenue first, then sum orders and revenue by day, then compute the Pearson correlation.',
  },
  'missing-revenue-rows': {
    title: 'Missing revenue',
    kind: 'Data quality',
    question: 'After deduplicating the sales data, how many rows have missing revenue?',
    hint: 'Remove exact duplicate rows first, then count rows with an empty revenue.',
  },
  'duplicate-rows': {
    title: 'Duplicate imports',
    kind: 'Data quality',
    question: 'How many extra rows in the sales data come from duplicate imports? (a row that appears 3 times counts as 2 extra rows)',
    hint: 'Extra rows = total rows − rows after deduplication (comparing whole rows).',
  },
  'top3-payers': {
    title: 'Top 3 payers',
    kind: 'Top-k + tie-breaking',
    question:
      'Which 3 users have the most payments (pay events)? Order by count descending, ties by user_id ascending, and answer comma-separated, e.g. u001,u002,u003.',
    hint: 'Events reported twice with the same event_id count once; on ties, order by user_id ascending.',
  },
  'cart-to-checkout': {
    title: 'Cart to checkout',
    kind: 'Funnel',
    question: 'Of the users who added to cart (add_cart), what percentage also checked out (checkout)? Count distinct users and round to two decimal places.',
    hint: 'The denominator is distinct users who added to cart; the numerator is those of them who also checked out.',
  },
  'android-share': {
    title: 'Android event share',
    kind: 'Share (platform spellings, duplicates)',
    question: 'What percentage of all events come from the Android platform? Round to two decimal places.',
    hint: 'Merge Android / android; events reported twice count once.',
  },
  'peak-dau-day': {
    title: 'Peak DAU day',
    kind: 'Categorical answer (dates)',
    question: 'Which day in March had the most daily active users (distinct users with any event that day)? On a tie, answer the earliest day, as YYYY-MM-DD.',
    hint: 'Group by date and count distinct user_id.',
  },
  'shanghai-nps': {
    title: 'Shanghai NPS',
    kind: 'Grouped metric (city spellings)',
    question: 'What is the NPS of users in Shanghai? (same definition as the overall NPS, rounded to one decimal place)',
    hint: "Shanghai is spelled several ways (Shanghai / Shanghai City / SHANGHAI / shanghai); invalid scores don't count.",
  },
  'delivery-complaints': {
    title: 'Delivery complaints',
    kind: 'Text filter',
    question: 'How many comments from detractors (scores 0–6) mention "delivery"?',
    hint: "Comments contain commas and quotes, so parse the CSV properly; responses with invalid scores aren't detractors; repeat submissions count once.",
  },
  'promoter-share-app': {
    title: 'Promoter share in the App channel',
    kind: 'Grouped share',
    question: 'Among valid responses submitted through the App channel, what percentage are promoters (scores 9–10)? Round to two decimal places.',
    hint: 'Only valid responses with channel App (valid score, deduplicated by resp_id).',
  },
}

export const ANALYSIS_TASKS: AnalysisTaskDef[] = L(
  ZH_TASKS,
  ZH_TASKS.map((d) => ({ ...d, ...EN_TASKS[d.id], mock: d.mock && { ...d.mock, ...EN_TASKS[d.id].mock } })),
)

// ———————————————————— 判定 ————————————————————

const goldCache = new Map<string, number | string>()
export function goldOf(def: AnalysisTaskDef): number | string {
  if (!goldCache.has(def.id)) goldCache.set(def.id, def.gold())
  return goldCache.get(def.id)!
}

const normCode = (s: string) => s.replace(/\s+/g, ' ').trim()
const normText = (s: string) => s.replace(/[\s"'“”‘’。.,，、:：]/g, '').toLowerCase()

/** 把答案解析成数字（容忍 "12.34%"、"1,234.5" 这类写法） */
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/[,，\s%元秒]/g, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

const decimalsOf = (x: number) => {
  const s = String(x)
  return s.includes('e') ? 99 : (s.split('.')[1] ?? '').length
}

function closeTo(a: number, gold: number, decimals?: number): boolean {
  const tol = decimals !== undefined ? 10 ** -decimals + 1e-9 : 1e-6 * Math.max(1, Math.abs(gold))
  return Math.abs(a - gold) <= tol
}

/** 答案和标准答案是否一致（不检查格式） */
export function sameAnswer(def: AnalysisTaskDef, answer: unknown): boolean {
  const gold = goldOf(def)
  if (typeof gold === 'number') {
    const a = asNumber(answer)
    return a !== null && closeTo(a, gold, def.decimals)
  }
  if (gold.includes(',')) return normList(String(answer)) === gold
  const a = normText(String(answer ?? ''))
  const g = normText(gold)
  return a === g || (a.includes(g) && a.length <= g.length + 4)
}

const normList = (s: string) =>
  s
    .split(/[,，、\s]+/)
    .filter(Boolean)
    .join(',')

/** 输出的最后几行里能不能找到这个答案（可复现检查：最终答案应该是代码最后打印的结果） */
export function outputHas(def: AnalysisTaskDef, fullOutput: string, answer: unknown): boolean {
  const output = fullOutput
    .split('\n')
    .filter((l) => l.trim())
    .slice(-3)
    .join('\n')
  const gold = goldOf(def)
  if (typeof gold === 'number') {
    const a = asNumber(answer)!
    return [...output.replace(/(\d),(?=\d{3})/g, '$1').matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].some((m) => closeTo(Number(m[0]), a, def.decimals))
  }
  if (gold.includes(',')) return normList(output).includes(normList(String(answer)))
  return output.includes(String(answer).trim())
}

const oneLine = (s: string, n = 120) => s.replace(/\s+/g, ' ').trim().slice(0, n)

export function judge(def: AnalysisTaskDef, env: AnalysisTaskEnv, out: AnalysisAnswer | undefined): CheckResult {
  if (!out || (typeof out.answer !== 'number' && typeof out.answer !== 'string') || typeof out.code !== 'string' || typeof out.explanation !== 'string')
    return {
      pass: false,
      reason: L('返回值格式不对：应为 { answer: number | string, code: string, explanation: string }', 'Wrong return shape: expected { answer: number | string, code: string, explanation: string }'),
    }
  if (!env.runs.length)
    return {
      pass: false,
      reason: L(
        `没有用 runCode 执行过任何代码，答案“${oneLine(String(out.answer), 40)}”是模型估出来的。数据分析的数字必须由代码算出来：给模型一个运行代码的工具（包装 env.runCode），并要求它用代码计算。`,
        `No code was ever run with runCode, so the answer "${oneLine(String(out.answer), 40)}" is the model's guess. Numbers in data analysis must come from code: give the model a code-running tool (wrapping env.runCode) and require it to compute with code.`,
      ),
    }

  const gold = goldOf(def)
  if (!sameAnswer(def, out.answer)) {
    const notNumber =
      typeof gold === 'number' && asNumber(out.answer) === null
        ? L(
            '（答案不是一个数字：模型可能没算出结果。检查运行代码的工具有没有把错误信息原样交还给模型，让它修正后重跑）',
            " (the answer isn't a number: the model may not have computed a result. Check that the code tool hands errors back to the model verbatim so it can fix and rerun)",
          )
        : ''
    return {
      pass: false,
      reason: L(
        `答案不对：期望 ${gold}，实际 ${oneLine(String(out.answer), 60)}${notNumber}。提示：${def.hint}`,
        `Wrong answer: expected ${gold}, got ${oneLine(String(out.answer), 60)}${notNumber}. Hint: ${def.hint}`,
      ),
    }
  }
  if (typeof gold === 'number' && def.decimals !== undefined && decimalsOf(asNumber(out.answer)!) > def.decimals)
    return {
      pass: false,
      reason: L(
        `数值对了，但格式不符合要求：题目要求保留 ${def.decimals} 位小数，实际是 ${out.answer}。把格式要求交给模型，或者在返回前按要求四舍五入。`,
        `Right value, wrong format: the question asks for ${def.decimals} decimal places, got ${out.answer}. Pass the format requirement to the model, or round as required before returning.`,
      ),
    }

  if (!env.runs.some((r) => normCode(r.code) === normCode(out.code)))
    return {
      pass: false,
      reason: L(
        `返回的 code 没有通过 runCode 执行过（共执行过 ${env.runs.length} 段代码）。返回实际算出这个答案的那段代码，方便复核。`,
        `The returned code was never run with runCode (${env.runs.length} snippets were run). Return the code that actually computed the answer so it can be checked.`,
      ),
    }
  const rerun = runInSandbox(out.code, datasets())
  if (!outputHas(def, rerun, out.answer))
    return {
      pass: false,
      reason: L(
        `结果不可复现：在全新的沙箱里重新运行返回的 code，输出的最后几行里找不到答案 ${out.answer}。输出：“${oneLine(rerun, 100)}”。返回的应该是完整、能独立运行、最后打印出最终答案的代码（不是数据探查或某一步的片段）。`,
        `Not reproducible: rerunning the returned code in a fresh sandbox, the answer ${out.answer} isn't in the last lines of the output. Output: "${oneLine(rerun, 100)}". Return complete, standalone code that prints the final answer last (not a profiling snippet or an intermediate step).`,
      ),
    }
  return { pass: true, reason: L(`答案正确（${gold}），代码可复现`, `Correct (${gold}), and the code reproduces it`) }
}

export function toTasks(): ProjectTask<AnalysisTaskEnv, AnalysisAnswer>[] {
  return ANALYSIS_TASKS.map((def) => ({
    id: def.id,
    title: def.title,
    core: def.core,
    input: def.question,
    check: ({ env, output }) => judge(def, env, output),
  }))
}
