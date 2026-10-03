import { L } from '../../../engine/locale'

/** 数据团队维护的数据字典：字段含义、状态码、金额单位、指标口径。describeTable 里没有这些信息。 */
const DATA_DICTIONARY_ZH = `# 拾光盒子 · 数据字典（v3.2）

数据截止日：2026-03-15。问题里的「今天」「今年」「本月」「上个月」「最近 N 天」都以这一天为准（最近 N 天含当天）。

## 通用规则

- 金额单位：orders.amt、order_items.unit_amt、refunds.refund_amt、products.list_price 都是整数，单位：分。对外报告一律换算成元（÷ 100，注意不要整数除法）。campaigns.budget 例外，单位是元。
- 测试账号不计入任何业务指标：customers.is_test = 1 是内部测试账号，统计时要排除他们的订单、会话和退款（除非问题问的就是测试账号）。
- 时间字段都是文本：orders.created_at、sessions.ts 形如 '2026-03-15 14:05:09'；customers.reg_dt、refunds.refund_dt 形如 '2026-03-15'。订单按 created_at 归属到日期 / 月份。

## 表

- customers 客户：tier 会员等级，0 = 普通，1 = 银卡，2 = 金卡；is_test 测试账号标记。
- orders 订单（唯一可信的订单表）：status 状态码，1 = 待支付，2 = 已支付，3 = 已发货，4 = 已完成，9 = 已取消。channel 渠道：app = App，mini = 微信小程序，web = 网页。campaign_id：带来这笔订单的营销活动，可以为空。
- order_items 订单明细：一行一个商品，qty 件数，unit_amt 成交单价。
- products 商品：is_active = 1 表示在售；list_price 标价。
- categories 类目：两级。parent_id 为空的是一级大类，其余是某个大类下的子类目；products.cat_id 指向子类目。
- refunds 退款：state = approved（已批准）/ rejected（已驳回）/ pending（待审核）。只有 approved 的退款真正退了钱。
- campaigns 营销活动：budget 预算。
- sessions 访问会话：用户每打开一次 App / 小程序 / 网页记一条。
- orders_old：⚠️ 已废弃。2025-06 系统迁移前的旧订单表快照：数据不完整、状态没有同步更新、有重复行，金额单位是元。任何统计都不要用它，一律用 orders。

## 指标口径

- 已支付订单：status ∈ {2, 3, 4}（已支付、已发货、已完成）。待支付和已取消的订单不算。
- GMV（成交额）：已支付订单的 amt 之和，换算成元。「销售额」「卖了多少钱」「流水」「营收」都按 GMV 口径。
- 净收入：GMV 减去这些订单上已批准（approved）退款的 refund_amt 之和（元）。
- 客单价：GMV ÷ 已支付订单数（元）。
- 商品销售额：已支付订单里该商品的 qty × unit_amt 之和（元）。
- 退款率：有已批准退款的已支付订单数 ÷ 已支付订单数，用小数表示。
- 活跃用户：最近 30 天（2026-02-14 至 2026-03-15，含两端）有过 session 的去重客户数。
- 新注册用户：按 customers.reg_dt 统计。
- 活动 ROI：活动带来的 GMV（orders.campaign_id 关联）÷ 活动预算 budget，两者都用元。
`

const DATA_DICTIONARY_EN = `# Glimmer Box · Data Dictionary (v3.2)

Data cutoff date: 2026-03-15. "Today", "this year", "this month", "last month" and "the last N days" in questions are all relative to this date (the last N days include it).

## General rules

- Money unit: orders.amt, order_items.unit_amt, refunds.refund_amt and products.list_price are integers in fen (cents). Always report in yuan (÷ 100 — watch out for integer division). Exception: campaigns.budget is in yuan.
- Test accounts never count toward business metrics: customers.is_test = 1 marks internal test accounts. Exclude their orders, sessions and refunds (unless the question is about test accounts).
- Time columns are text: orders.created_at and sessions.ts look like '2026-03-15 14:05:09'; customers.reg_dt and refunds.refund_dt look like '2026-03-15'. Orders belong to the day / month of created_at.

## Tables

- customers: tier is the membership level, 0 = regular, 1 = silver, 2 = gold; is_test flags test accounts.
- orders (the only trustworthy orders table): status code 1 = pending payment, 2 = paid, 3 = shipped, 4 = completed, 9 = cancelled. channel: app = mobile app, mini = WeChat mini program, web = website. campaign_id: the marketing campaign that brought in the order; may be NULL.
- order_items: one row per product in an order; qty = quantity, unit_amt = actual unit price.
- products: is_active = 1 means on sale; list_price is the list price.
- categories: two levels. Rows with NULL parent_id are top-level categories; the rest are subcategories under one of them. products.cat_id points to a subcategory.
- refunds: state = approved / rejected / pending. Only approved refunds actually paid money back.
- campaigns: marketing campaigns; budget is the campaign budget.
- sessions: one row each time a user opens the app / mini program / website.
- orders_old: ⚠️ deprecated. Snapshot of the old orders table from before the 2025-06 migration: incomplete, stale statuses, duplicate rows, amounts in yuan. Never use it for any metric — always use orders.

## Metric definitions

- Paid orders: status ∈ {2, 3, 4} (paid, shipped, completed). Pending and cancelled orders don't count.
- GMV (gross merchandise value): sum of amt over paid orders, in yuan. "Sales", "how much we sold", "revenue" and "turnover" all mean GMV.
- Net revenue: GMV minus the refund_amt of approved refunds on those orders (yuan).
- AOV (average order value): GMV ÷ number of paid orders (yuan).
- Product sales: sum of qty × unit_amt for the product across paid orders (yuan).
- Refund rate: paid orders with an approved refund ÷ paid orders, as a decimal.
- Active users: distinct customers with at least one session in the last 30 days (2026-02-14 to 2026-03-15, inclusive).
- New users: counted by customers.reg_dt.
- Campaign ROI: GMV brought in by the campaign (joined via orders.campaign_id) ÷ campaign budget, both in yuan.
`

export const DATA_DICTIONARY = L(DATA_DICTIONARY_ZH, DATA_DICTIONARY_EN)

/** 数据字典里各条规则的标志性文字：模拟模型据此判断它“读过”哪条规则 */
export const DICT_ZH = {
  today: '数据截止日：2026-03-15',
  cents: '单位：分',
  test: '测试账号不计入任何业务指标',
  status: '4 = 已完成，9 = 已取消',
  old: '已废弃',
  paid: '已支付订单：status ∈ {2, 3, 4}',
  gmv: 'GMV（成交额）',
  net: '净收入：',
  aov: '客单价：',
  item: '商品销售额：',
  refundRate: '退款率：',
  active: '活跃用户：最近 30 天',
  tier: '2 = 金卡',
  category: 'parent_id 为空的是一级大类',
  refundState: '只有 approved 的退款真正退了钱',
  roi: '活动 ROI',
  channel: 'mini = 微信小程序',
} as const

/** 英文数据字典里对应的标志性文字（key 和 DICT_ZH 一一对应） */
export const DICT_EN: Record<keyof typeof DICT_ZH, string> = {
  today: 'Data cutoff date: 2026-03-15',
  cents: 'integers in fen (cents)',
  test: 'Test accounts never count toward business metrics',
  status: '4 = completed, 9 = cancelled',
  old: '⚠️ deprecated',
  paid: 'Paid orders: status ∈ {2, 3, 4}',
  gmv: 'GMV (gross merchandise value)',
  net: 'Net revenue:',
  aov: 'AOV (average order value):',
  item: 'Product sales:',
  refundRate: 'Refund rate:',
  active: 'Active users: distinct customers with at least one session in the last 30 days',
  tier: '2 = gold',
  category: 'Rows with NULL parent_id are top-level categories',
  refundState: 'Only approved refunds actually paid money back',
  roi: 'Campaign ROI',
  channel: 'mini = WeChat mini program',
}

/** 当前语言的数据字典里的标志性文字 */
export const DICT: Record<keyof typeof DICT_ZH, string> = L(DICT_ZH, DICT_EN)
