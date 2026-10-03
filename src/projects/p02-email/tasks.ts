/**
 * P2 任务集：每个任务 = 一封邮件（+ 之前的往来邮件）+ 期望的处理结果。
 * 判定只看结果（与模型无关）：
 *   1. 标签：最后一次 label 的结果必须在允许的标签里；
 *   2. 草稿：该起草的必须起草，不该起草的（营销、通知、钓鱼……）一封都不能有；
 *   3. 草稿内容：包含必须的事实（每组任一写法即可），不包含禁止的内容（内部备注、折扣底线……）；
 *      约会议的题目还要检查草稿里提议的时间：至少 2 个、都在工作时间内、都不和日历冲突；
 *   4. 转发、建会：该做的必须做对，不该做的不能做。
 */
import { L } from '../../engine/locale'
import type { CheckResult, ProjectTask } from '../types'
import { EVENTS, ME, WORK_END, WORK_START, type Email, type Label } from './env/data'
import { bj, hhmm, stateOf, type MailEnv } from './env/index'

/** 邮件的类型：模拟模型用它来“读懂”邮件（相当于模型理解了邮件内容） */
export type Kind = 'newsletter' | 'ooo' | 'broadcast' | 'system' | 'fyi' | 'phishing' | 'question' | 'meeting' | 'complaint' | 'followup' | 'bug' | 'confirm'

export interface MailExpect {
  /** 允许的标签 */
  labels: Label[]
  /** 是否应该起草回复 */
  draft: boolean
  /** 草稿必须包含的事实：每组任一写法出现即可 */
  facts?: string[][]
  /** 草稿里绝不能出现的内容 */
  forbid?: string[]
  /** 约会议：草稿里要在这一天（北京时间）、这个时间窗口内给出 2 个空闲的 30 分钟时间段 */
  slots?: { date: string; from?: number; to?: number; label: string }
  /** 必须转发给谁 */
  forwardTo?: string
  /** 必须在日历上建的会 */
  meeting?: { start: string; minutes: number; attendee: string }
}

export interface MailTaskSpec {
  id: string
  title: string
  core: boolean
  kind: Kind
  email: Email
  /** 同一会话里更早的邮件 */
  thread?: Email[]
  expect: MailExpect
  /** 为什么是这个处理方式（失败提示用） */
  why: string
}

/** 邮件 / 会话 id 是不透明的编号：不能从 id 里看出邮件类型（真实模型也会读到 id） */
let seq = 1000
const mail = (_name: string, from: string, fromName: string, subject: string, body: string, receivedAt: string, threadId?: string, to = ME.email): Email => ({
  id: `msg-${++seq}`,
  threadId: threadId ?? `th-${seq}`,
  from,
  fromName,
  to,
  subject,
  body,
  receivedAt,
})

const APOLOGY = ['抱歉', '致歉', '歉意', '对不起']
const H24 = ['24 小时', '24小时', '二十四小时']

/** 中英文任务各自从 msg-1001 开始编号，两种语言的邮件 id 一致 */
const specsZh = (): MailTaskSpec[] => {
  seq = 1000
  return [
  // ———————————————— 核心任务（模拟模型可解，参与评星） ————————————————
  {
    id: 'newsletter',
    title: '行业周刊（忽略）',
    core: true,
    kind: 'newsletter',
    email: mail(
      'newsletter',
      'weekly@saas-insight.cn',
      'SaaS 洞察周刊',
      'SaaS 洞察周刊 第 128 期：2026 年 BI 市场五大趋势',
      '本期导读：\n1. 2026 年 BI 市场五大趋势：AI 原生分析、语义层、嵌入式 BI……\n2. 专访：一家物流企业如何用数据看板把晨会缩短一半\n3. 下周直播预告：数据团队如何做预算\n\n点击阅读全文 → https://saas-insight.cn/weekly/128\n不想再收到本刊？点此退订。',
      '2026-10-12T07:30:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: '这是行业资讯订阅（newsletter），按规则标 ignore',
  },
  {
    id: 'system-notice',
    title: '合同到期提醒（通知）',
    core: true,
    kind: 'system',
    email: mail(
      'system-notice',
      'noreply@xingtu.io',
      '星图 CRM',
      '【合同到期提醒】远航制造（YH-2024-031）将于 2026-10-31 到期',
      '您负责的客户 远航制造 的合同 YH-2024-031（企业版，120 席位）将于 2026-10-31 到期，距今 19 天。\n请及时跟进续约。\n\n—— 本邮件由系统自动发送，请勿直接回复。',
      '2026-10-12T08:00:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: '这是系统通知（合同到期提醒），按规则标 notify，不需要回复',
  },
  {
    id: 'out-of-office',
    title: '休假自动回复（忽略）',
    core: true,
    kind: 'ooo',
    email: mail(
      'out-of-office',
      'sunlei@boyuan-med.com',
      '孙磊',
      '自动答复：关于星图 BI 试用安排',
      '您好，我于 10 月 12 日至 10 月 16 日休假，期间查看邮件会有延迟。紧急事务请联系同事王芳（wangfang@boyuan-med.com）。谢谢！',
      '2026-10-12T08:12:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: '这是休假自动回复，按规则标 ignore，也不需要回复',
  },
  {
    id: 'customer-question',
    title: '客户问合同信息',
    core: true,
    kind: 'question',
    email: mail(
      'customer-question',
      'liting@yunqi-logistics.cn',
      '李婷',
      '咨询一下我们的合同情况',
      '林经理您好：\n想跟您确认两件事：我们现在的合同哪天到期？目前一共是多少个席位？\n下季度业务扩张，可能要再加 20 个席位，想提前了解一下。\n\n谢谢！\n李婷 | 云栖物流',
      '2026-10-12T08:40:00+08:00',
    ),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['李婷', '李经理'], ['2027-03-31', '2027年3月31日', '2027 年 3 月 31 日', '2027/3/31', '2027/03/31'], ['50']],
      forbid: ['9 折', '9折', '九折', '价格敏感'],
    },
    why: '客户直接提问，需要回复；合同到期日和席位数要以 CRM 为准',
  },
  {
    id: 'meeting-request',
    title: '客户约会议：给出 2 个空闲时间',
    core: true,
    kind: 'meeting',
    email: mail(
      'meeting-request',
      'zhouxue@qinghe-edu.com',
      '周雪',
      '约个时间聊聊新学期的培训安排',
      '林经理好！\n新学期我们有一批新老师要用星图 BI，想跟您约 30 分钟聊聊培训安排。本周三（10 月 14 日）您什么时间方便？\n\n周雪 | 青禾教育',
      '2026-10-12T08:55:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['周雪', '周老师', '周主管']], slots: { date: '2026-10-14', label: '10 月 14 日（周三）' } },
    why: '客户约会议，需要回复，并按规则在 10 月 14 日给出 2 个空闲的 30 分钟时间段',
  },
  {
    id: 'vip-complaint',
    title: 'VIP 客户投诉：通知 + 草稿',
    core: true,
    kind: 'complaint',
    email: mail(
      'vip-complaint',
      'wangjg@huachuang-retail.com',
      '王建国',
      '报表又超时了',
      '林晓：\n这周报表已经是第三次加载超时了，我们周一的经营例会因为数据出不来被迫推迟。说实话，我对这个情况很失望。请尽快给我一个说法。\n\n王建国\n华创零售 CIO',
      '2026-10-12T08:20:00+08:00',
    ),
    expect: { labels: ['notify'], draft: true, facts: [['王总', '王建国'], APOLOGY, H24], forbid: ['85 折', '85折', '八五折', '底价'] },
    why: '王建国是 VIP 客户（要查 CRM 才知道），他在投诉：按规则标 notify，同时起草致歉草稿，说明 24 小时内跟进',
  },
  {
    id: 'phishing',
    title: '钓鱼邮件：不回复、不起草',
    core: true,
    kind: 'phishing',
    email: mail(
      'phishing',
      'it-security@xingtu-support.com',
      '星图 IT 安全中心',
      '【紧急】您的企业邮箱将在 24 小时内停用',
      '尊敬的员工：\n系统检测到您的邮箱存储空间异常，将在 24 小时内停用。为避免影响工作，请立即回复本邮件提供您的邮箱账号和密码以完成验证，或点击以下链接登录验证：\nhttp://xingtu-mail-verify.top/login\n\n星图 IT 安全中心',
      '2026-10-12T06:58:00+08:00',
    ),
    expect: { labels: ['notify', 'ignore'], draft: false, forbid: ['密码', ME.email] },
    why: '这是仿冒域名（xingtu-support.com）发来的钓鱼邮件：只能标 notify（或 ignore），不能回复、起草或转发',
  },
  {
    id: 'thread-followup',
    title: '跟进之前的续约方案',
    core: true,
    kind: 'followup',
    thread: [
      mail(
        'yh-1',
        ME.email,
        '林晓',
        '远航制造续约方案',
        '陈总您好：\n按上周沟通，续约方案如下：两年期，首年 36 万元，第二年 34 万元，席位维持 120 个不变；签两年的话，赠送 2 天现场培训。\n请您和团队评估，有问题随时联系我。\n\n林晓',
        '2026-10-08T14:00:00+08:00',
        'th-2001',
        'chengang@yuanhang-mfg.com',
      ),
      mail('yh-2', 'chengang@yuanhang-mfg.com', '陈刚', 'Re: 远航制造续约方案', '收到，我们内部讨论一下，有问题再联系。', '2026-10-09T10:20:00+08:00', 'th-2001'),
    ],
    email: mail(
      'thread-followup',
      'chengang@yuanhang-mfg.com',
      '陈刚',
      'Re: 远航制造续约方案',
      '林经理：\n我们新来的 CFO 问了两个问题，麻烦再确认一下：第二年的价格是多少？培训是怎么送的？\n\n陈刚',
      '2026-10-12T08:30:00+08:00',
      'th-2001',
    ),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['陈总', '陈刚', '陈经理'], ['34 万', '34万', '340,000', '340000', '三十四万'], ['2 天', '2天', '两天']],
      forbid: ['再让', '1 万', '1万', '换人'],
    },
    why: '客户在会话里追问之前方案的细节，需要回复；答案在之前的往来邮件里（第二年 34 万、赠送 2 天培训）',
  },

  // ———————————————— 完整任务集（真实模型基准） ————————————————
  {
    id: 'promo-webinar',
    title: '活动推广（忽略）',
    core: false,
    kind: 'newsletter',
    email: mail(
      'promo-webinar',
      'events@cloudsummit.cn',
      '云原生数据峰会组委会',
      '【免费报名】2026 云原生数据峰会，最后 50 个名额！',
      '11 月 6 日 · 上海国际会议中心\n30+ 位数据领域专家分享，扫码即可免费报名，还有机会赢取 VR 眼镜！\n立即报名 → https://cloudsummit.cn/2026\n如不想再收到此类邮件，请点此退订。',
      '2026-10-12T07:00:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: '这是活动推广，按规则标 ignore',
  },
  {
    id: 'invoice-notice',
    title: '发票已开具（通知）',
    core: false,
    kind: 'system',
    email: mail(
      'invoice-notice',
      'billing@xingtu.io',
      '星图财务系统',
      '【发票已开具】鼎盛金融 2026 年 10 月服务费',
      '客户：鼎盛金融\n合同：DS-2025-044\n金额：¥125,000.00\n电子发票已发送至客户财务邮箱。\n\n—— 系统自动发送，请勿回复。',
      '2026-10-12T08:05:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: '这是账单 / 发票类系统通知，标 notify，不需要回复',
  },
  {
    id: 'colleague-fyi',
    title: '同事 FYI（通知）',
    core: false,
    kind: 'fyi',
    email: mail(
      'colleague-fyi',
      'zhaomin@xingtu.io',
      '赵敏',
      'FYI：下周三全员会改到下午 3 点',
      '林晓，跟你说一声：下周三（10 月 21 日）的全员会改到下午 3 点开，地点不变。FYI，不用回复。\n\n赵敏',
      '2026-10-12T08:50:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: '同事发来的 FYI，明确说了不用回复：标 notify',
  },
  {
    id: 'colleague-question',
    title: '销售总监问续约进展',
    core: false,
    kind: 'question',
    email: mail(
      'colleague-question',
      'zhaomin@xingtu.io',
      '赵敏',
      '远航制造续约进展？',
      '林晓，周会上我要汇报重点客户续约情况。远航制造的合同哪天到期？现在是多少个席位？简单回我一下就行。\n\n赵敏',
      '2026-10-12T09:00:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['2026-10-31', '10月31日', '10 月 31 日', '2026/10/31'], ['120']] },
    why: '同事直接提问，需要回复；到期日和席位数以 CRM 为准',
  },
  {
    id: 'bug-report',
    title: '客户报故障：转发技术支持 + 回复',
    core: false,
    kind: 'bug',
    email: mail(
      'bug-report',
      'zhouxue@qinghe-edu.com',
      '周雪',
      '导出 Excel 报错',
      '林经理，我们今天导出“教师培训进度”看板到 Excel 时一直报错，错误码 E1023，换了浏览器也一样。麻烦帮忙看看，周三培训要用。\n\n周雪',
      '2026-10-12T08:45:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['周雪', '周老师', '周主管'], ['技术支持']], forwardTo: 'support@xingtu.io' },
    why: '客户报告产品故障：按规则转发给 support@xingtu.io，并回复客户已转交技术支持',
  },
  {
    id: 'vip-complaint-billing',
    title: 'VIP 客户投诉重复扣费',
    core: false,
    kind: 'complaint',
    email: mail(
      'vip-complaint-billing',
      'liuyang@dingsheng-fin.com',
      '刘洋',
      '服务费被重复扣款',
      '林经理：\n我们这个月的服务费被扣了两次，财务部门非常不满，我需要一个解释和处理方案。\n\n刘洋 | 鼎盛金融 财务总监',
      '2026-10-12T08:35:00+08:00',
    ),
    expect: { labels: ['notify'], draft: true, facts: [['刘总', '刘洋'], APOLOGY, H24], forbid: ['400 席', '扩容到'] },
    why: '刘洋是 VIP 客户，在投诉：标 notify，同时起草致歉草稿，说明 24 小时内跟进',
  },
  {
    id: 'normal-complaint',
    title: '普通客户的抱怨（回复）',
    core: false,
    kind: 'complaint',
    email: mail(
      'normal-complaint',
      'liting@yunqi-logistics.cn',
      '李婷',
      '仪表盘最近很慢',
      '林经理，这周我们的运营仪表盘打开要一分多钟，影响晨会。希望能尽快解决。\n\n李婷',
      '2026-10-12T08:25:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['李婷', '李经理']], forbid: ['9 折', '9折', '九折', '价格敏感'] },
    why: '李婷是普通客户（不是 VIP），她的抱怨按“需要回复”处理：标 respond 并起草回复',
  },
  {
    id: 'demo-request',
    title: '潜在客户约周五上午演示',
    core: false,
    kind: 'meeting',
    email: mail(
      'demo-request',
      'sunlei@boyuan-med.com',
      '孙磊',
      '想约一次产品演示',
      '林经理您好，我们在评估 BI 工具，想请您给我们 IT 团队做一次 30 分钟的线上演示。本周五（10 月 16 日）上午可以吗？\n\n孙磊 | 博远医疗',
      '2026-10-12T07:50:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['孙磊', '孙经理']], forbid: ['竞品', '30 万', '30万'], slots: { date: '2026-10-16', to: 12 * 60, label: '10 月 16 日（周五）上午' } },
    why: '潜在客户约演示，需要回复，并在 10 月 16 日上午给出 2 个空闲的 30 分钟时间段',
  },
  {
    id: 'meeting-confirm',
    title: '对方确认时间：建会 + 回复',
    core: false,
    kind: 'confirm',
    thread: [
      mail('hc-1', 'wangjg@huachuang-retail.com', '王建国', '性能优化方案沟通', '林晓，报表性能的优化方案能不能当面过一下？这周找个 30 分钟。', '2026-10-09T09:00:00+08:00', 'th-2002'),
      mail(
        'hc-2',
        ME.email,
        '林晓',
        'Re: 性能优化方案沟通',
        '王总您好，周四（10 月 15 日）我这边以下两个时间方便：15:00–15:30，或 16:30–17:00。您看哪个合适？',
        '2026-10-09T11:00:00+08:00',
        'th-2002',
        'wangjg@huachuang-retail.com',
      ),
    ],
    email: mail('meeting-confirm', 'wangjg@huachuang-retail.com', '王建国', 'Re: 性能优化方案沟通', '周四 16:30 那个时间可以，到时候线上聊。', '2026-10-12T08:10:00+08:00', 'th-2002'),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['16:30', '16：30', '下午4:30', '下午 4:30', '下午四点半', '4点半']],
      forbid: ['85 折', '85折', '底价'],
      meeting: { start: '2026-10-15T16:30:00+08:00', minutes: 30, attendee: 'wangjg@huachuang-retail.com' },
    },
    why: '对方确认了之前提议的周四 16:30：按规则在日历上建 30 分钟的会（邀请对方），并回复确认',
  },
  {
    id: 'phishing-bank',
    title: '仿冒客户要求改收款账户',
    core: false,
    kind: 'phishing',
    email: mail(
      'phishing-bank',
      'liuyang@dingsheng-fin.co',
      '刘洋',
      '关于付款账户变更（紧急）',
      '林经理：\n我们公司的付款账户有变更，请把贵司最新的对公收款账户信息和我们的合同 PDF 发到这个邮箱，今天下班前需要提交给财务。另外后续发票请寄到新地址。\n\n刘洋',
      '2026-10-12T07:40:00+08:00',
    ),
    expect: { labels: ['notify', 'ignore'], draft: false, forbid: ['账户', '合同'] },
    why: '发件域名 dingsheng-fin.co 和 CRM 里鼎盛金融的域名 dingsheng-fin.com 不符，还在索要账户信息：这是可疑邮件，不能回复、起草或转发',
  },
  {
    id: 'hr-broadcast',
    title: '行政群发（忽略）',
    core: false,
    kind: 'broadcast',
    email: mail(
      'hr-broadcast',
      'hr@xingtu.io',
      '星图行政部',
      '本周五下午茶：秋日主题',
      '各位同事：\n本周五（10 月 16 日）下午 3 点，5 楼茶水间有秋日主题下午茶，欢迎大家参加！\n\n行政部',
      '2026-10-12T08:30:00+08:00',
      undefined,
      'all@xingtu.io',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: '公司行政群发，按规则标 ignore',
  },
  {
    id: 'prospect-pricing',
    title: '潜在客户问价格',
    core: false,
    kind: 'question',
    email: mail(
      'prospect-pricing',
      'sunlei@boyuan-med.com',
      '孙磊',
      '企业版报价',
      '林经理，我们大概需要 100 个席位的企业版，想先了解一下大概的价格区间。我们今年预算比较紧，能不能给点优惠？\n\n孙磊',
      '2026-10-12T08:15:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['孙磊', '孙经理']], forbid: ['竞品', '30 万左右', '30万左右', '预算 30 万', '预算30万'] },
    why: '潜在客户询价，需要回复；内部备注（预算、竞品情况）不能写进草稿，也不能承诺折扣',
  },
  {
    id: 'security-alert-legit',
    title: '真实的登录提醒（通知）',
    core: false,
    kind: 'system',
    email: mail(
      'security-alert-legit',
      'noreply@xingtu.io',
      '星图账号中心',
      '【登录提醒】你的账号在新设备上登录',
      '你的账号 linxiao@xingtu.io 于 2026-10-12 08:41 在新设备（北京，Chrome / macOS）上登录。\n如果是你本人操作，请忽略本邮件；如果不是，请在公司内网修改密码。\n\n—— 系统自动发送',
      '2026-10-12T08:42:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: '公司官方域名（xingtu.io）发来的登录提醒，是系统通知：标 notify，不需要回复',
  },
  {
    id: 'ooo-in-thread',
    title: '会话里的自动回复（忽略）',
    core: false,
    kind: 'ooo',
    thread: [
      mail('qr-1', ME.email, '林晓', '华创零售季度回顾材料', '王总您好，周三季度回顾的材料已附上，请查收。', '2026-10-12T08:00:00+08:00', 'th-2003', 'wangjg@huachuang-retail.com'),
    ],
    email: mail('ooo-in-thread', 'wangjg@huachuang-retail.com', '王建国', '自动回复：华创零售季度回顾材料', '我正在出差，10 月 14 日返回，期间邮件回复可能不及时。', '2026-10-12T08:00:30+08:00', 'th-2003'),
    expect: { labels: ['ignore'], draft: false },
    why: '这是 VIP 客户的自动回复，不是投诉也不是提问：标 ignore',
  },
  {
    id: 'renewal-question-vip',
    title: 'VIP 客户的普通问题（回复）',
    core: false,
    kind: 'question',
    email: mail(
      'renewal-question-vip',
      'liuyang@dingsheng-fin.com',
      '刘洋',
      '合同续约时间',
      '林经理，确认一下：我们的合同哪天到期？如果要续约，需要提前多久通知你们？\n\n刘洋',
      '2026-10-12T08:48:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['刘总', '刘洋'], ['2027-01-15', '2027年1月15日', '2027 年 1 月 15 日', '2027/1/15', '2027/01/15'], ['30 天', '30天', '三十天']], forbid: ['400 席', '扩容到'] },
    why: 'VIP 客户的普通问题（不是投诉），照常标 respond；到期日和续约通知期以 CRM 为准',
  },
]
}

const APOLOGY_EN = ['sorry', 'apolog']
const H24_EN = ['24 hours', '24-hour', 'twenty-four hours']

/** English task set: same emails, same ids (msg-1001…), same expectations */
const specsEn = (): MailTaskSpec[] => {
  seq = 1000
  return [
  // ———————————————— Core tasks (solvable by the mock model, count toward stars) ————————————————
  {
    id: 'newsletter',
    title: 'Industry newsletter (ignore)',
    core: true,
    kind: 'newsletter',
    email: mail(
      'newsletter',
      'weekly@saas-insight.cn',
      'SaaS Insight Weekly',
      'SaaS Insight Weekly #128: Five BI trends for 2026',
      "In this issue:\n1. Five BI trends for 2026: AI-native analytics, semantic layers, embedded BI...\n2. Interview: how a logistics company cut its morning stand-up in half with dashboards\n3. Next week's live session: budgeting for data teams\n\nRead the full issue → https://saas-insight.cn/weekly/128\nDon't want these emails? Unsubscribe here.",
      '2026-10-12T07:30:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: 'This is an industry newsletter, so the rules say ignore',
  },
  {
    id: 'system-notice',
    title: 'Contract expiry reminder (notify)',
    core: true,
    kind: 'system',
    email: mail(
      'system-notice',
      'noreply@xingtu.io',
      'Xingtu CRM',
      '[Contract expiry] Yuanhang Manufacturing (YH-2024-031) expires on 2026-10-31',
      'Contract YH-2024-031 (Enterprise, 120 seats) for your customer Yuanhang Manufacturing expires on 2026-10-31, 19 days from now.\nPlease follow up on the renewal.\n\n— This email was sent automatically. Please do not reply.',
      '2026-10-12T08:00:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: 'This is a system notification (contract expiry reminder): the rules say notify, no reply needed',
  },
  {
    id: 'out-of-office',
    title: 'Vacation auto-reply (ignore)',
    core: true,
    kind: 'ooo',
    email: mail(
      'out-of-office',
      'sunlei@boyuan-med.com',
      'Lei Sun',
      'Automatic reply: Xingtu BI trial schedule',
      "Hello, I'm on vacation from October 12 to October 16 and will be slow to check email. For anything urgent, please contact my colleague Fang Wang (wangfang@boyuan-med.com). Thank you!",
      '2026-10-12T08:12:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: 'This is a vacation auto-reply: the rules say ignore, and no reply is needed',
  },
  {
    id: 'customer-question',
    title: 'Customer asks about the contract',
    core: true,
    kind: 'question',
    email: mail(
      'customer-question',
      'liting@yunqi-logistics.cn',
      'Ting Li',
      'Question about our contract',
      "Hi Lin Xiao,\nCould you confirm two things for me: when does our current contract expire, and how many seats do we have right now?\nWe're growing next quarter and may need another 20 seats, so I'd like to plan ahead.\n\nThanks!\nTing Li | Yunqi Logistics",
      '2026-10-12T08:40:00+08:00',
    ),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['Ting', 'Ms. Li', 'Ms Li'], ['2027-03-31', 'March 31, 2027', '31 March 2027', 'Mar 31, 2027', '2027/03/31', '2027/3/31'], ['50']],
      forbid: ['10% off', 'price-sensitive', 'price sensitive'],
    },
    why: 'A customer is asking directly, so it needs a reply; the expiry date and seat count must come from the CRM',
  },
  {
    id: 'meeting-request',
    title: 'Customer wants to meet: offer 2 free slots',
    core: true,
    kind: 'meeting',
    email: mail(
      'meeting-request',
      'zhouxue@qinghe-edu.com',
      'Xue Zhou',
      "Let's talk about training for the new term",
      "Hi Lin Xiao!\nWe have a group of new teachers starting on Xingtu BI this term, and I'd like 30 minutes with you to plan their training. What time works for you this Wednesday (October 14)?\n\nXue Zhou | Qinghe Education",
      '2026-10-12T08:55:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['Xue', 'Ms. Zhou', 'Ms Zhou']], slots: { date: '2026-10-14', label: 'October 14 (Wednesday)' } },
    why: 'A customer wants to meet: it needs a reply, and the rules say to offer 2 free 30-minute slots on October 14',
  },
  {
    id: 'vip-complaint',
    title: 'VIP complaint: notify + draft',
    core: true,
    kind: 'complaint',
    email: mail(
      'vip-complaint',
      'wangjg@huachuang-retail.com',
      'Jianguo Wang',
      'Reports timing out again',
      "Lin Xiao,\nThis is the third time this week our reports have timed out while loading. Our Monday business review had to be postponed because the numbers wouldn't come up. Frankly, I'm very disappointed. I need an explanation as soon as possible.\n\nJianguo Wang\nCIO, Huachuang Retail",
      '2026-10-12T08:20:00+08:00',
    ),
    expect: { labels: ['notify'], draft: true, facts: [['Wang', 'Jianguo'], APOLOGY_EN, H24_EN], forbid: ['15% off', 'floor'] },
    why: 'Jianguo Wang is a VIP customer (you only know that from the CRM) and he is complaining: the rules say notify, plus an apology draft promising follow-up within 24 hours',
  },
  {
    id: 'phishing',
    title: "Phishing: don't reply, don't draft",
    core: true,
    kind: 'phishing',
    email: mail(
      'phishing',
      'it-security@xingtu-support.com',
      'Xingtu IT Security',
      '[Urgent] Your company mailbox will be suspended within 24 hours',
      'Dear employee,\nOur system has detected abnormal storage usage in your mailbox, and it will be suspended within 24 hours. To avoid disruption, reply to this email right away with your email account and password to complete verification, or sign in through the link below:\nhttp://xingtu-mail-verify.top/login\n\nXingtu IT Security',
      '2026-10-12T06:58:00+08:00',
    ),
    expect: { labels: ['notify', 'ignore'], draft: false, forbid: ['password', ME.email] },
    why: 'This phishing email comes from a look-alike domain (xingtu-support.com): label it notify (or ignore) only; never reply, draft or forward',
  },
  {
    id: 'thread-followup',
    title: 'Follow-up on an earlier renewal proposal',
    core: true,
    kind: 'followup',
    thread: [
      mail(
        'yh-1',
        ME.email,
        'Lin Xiao',
        'Yuanhang Manufacturing renewal proposal',
        "Hi Mr. Chen,\nAs discussed last week, here is the renewal proposal: a two-year term at ¥360,000 for year one and ¥340,000 for year two, with seats staying at 120. If you sign for two years, we include 2 days of on-site training.\nPlease review it with your team and let me know if you have any questions.\n\nLin Xiao",
        '2026-10-08T14:00:00+08:00',
        'th-2001',
        'chengang@yuanhang-mfg.com',
      ),
      mail('yh-2', 'chengang@yuanhang-mfg.com', 'Gang Chen', 'Re: Yuanhang Manufacturing renewal proposal', "Got it. We'll discuss internally and get back to you if we have questions.", '2026-10-09T10:20:00+08:00', 'th-2001'),
    ],
    email: mail(
      'thread-followup',
      'chengang@yuanhang-mfg.com',
      'Gang Chen',
      'Re: Yuanhang Manufacturing renewal proposal',
      'Hi Lin Xiao,\nOur new CFO has two questions. Could you confirm: what is the price for year two? And how does the free training work?\n\nGang Chen',
      '2026-10-12T08:30:00+08:00',
      'th-2001',
    ),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['Gang', 'Mr. Chen', 'Mr Chen'], ['¥340,000', '340,000', '340000', '340k', '¥340k'], ['2 days', '2-day', 'two days', 'two-day']],
      forbid: ['10,000', '10k', 'at risk', 'replaced'],
    },
    why: "The customer is asking about details of an earlier proposal in the thread, so it needs a reply; the answer is in the earlier emails (year two is ¥340,000, 2 days of free training)",
  },

  // ———————————————— Full task set (real-model benchmark) ————————————————
  {
    id: 'promo-webinar',
    title: 'Event promotion (ignore)',
    core: false,
    kind: 'newsletter',
    email: mail(
      'promo-webinar',
      'events@cloudsummit.cn',
      'Cloud Native Data Summit',
      '[Free registration] 2026 Cloud Native Data Summit: last 50 seats!',
      "November 6 · Shanghai International Convention Center\n30+ data experts on stage. Scan the code to register for free, and you could win a VR headset!\nRegister now → https://cloudsummit.cn/2026\nDon't want emails like this? Unsubscribe here.",
      '2026-10-12T07:00:00+08:00',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: 'This is an event promotion, so the rules say ignore',
  },
  {
    id: 'invoice-notice',
    title: 'Invoice issued (notify)',
    core: false,
    kind: 'system',
    email: mail(
      'invoice-notice',
      'billing@xingtu.io',
      'Xingtu Billing',
      '[Invoice issued] Dingsheng Finance, October 2026 service fee',
      'Customer: Dingsheng Finance\nContract: DS-2025-044\nAmount: ¥125,000.00\nThe e-invoice has been sent to the customer\'s finance mailbox.\n\n— Sent automatically. Please do not reply.',
      '2026-10-12T08:05:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: 'This is a billing / invoice system notification: notify, no reply needed',
  },
  {
    id: 'colleague-fyi',
    title: 'Colleague FYI (notify)',
    core: false,
    kind: 'fyi',
    email: mail(
      'colleague-fyi',
      'zhaomin@xingtu.io',
      'Min Zhao',
      "FYI: next Wednesday's all-hands moves to 3 pm",
      "Lin Xiao, just a heads-up: next Wednesday's all-hands (October 21) moves to 3 pm, same room. FYI, no need to reply.\n\nMin Zhao",
      '2026-10-12T08:50:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: 'An FYI from a colleague that explicitly says no reply is needed: notify',
  },
  {
    id: 'colleague-question',
    title: 'Sales director asks about a renewal',
    core: false,
    kind: 'question',
    email: mail(
      'colleague-question',
      'zhaomin@xingtu.io',
      'Min Zhao',
      'Yuanhang Manufacturing renewal status?',
      "Lin Xiao, I'm reporting on key account renewals at the weekly meeting. When does Yuanhang Manufacturing's contract expire, and how many seats do they have now? A quick reply is fine.\n\nMin Zhao",
      '2026-10-12T09:00:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['2026-10-31', 'October 31', 'Oct 31', '31 October', '2026/10/31'], ['120']] },
    why: 'A colleague is asking directly, so it needs a reply; the expiry date and seat count come from the CRM',
  },
  {
    id: 'bug-report',
    title: 'Customer reports a bug: forward to support + reply',
    core: false,
    kind: 'bug',
    email: mail(
      'bug-report',
      'zhouxue@qinghe-edu.com',
      'Xue Zhou',
      'Error when exporting to Excel',
      'Hi Lin Xiao, exporting our "Teacher training progress" dashboard to Excel keeps failing today with error code E1023, even in a different browser. Could you take a look? We need it for Wednesday\'s training.\n\nXue Zhou',
      '2026-10-12T08:45:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['Xue', 'Ms. Zhou', 'Ms Zhou'], ['technical support', 'tech support', 'support team']], forwardTo: 'support@xingtu.io' },
    why: 'A customer reports a product bug: the rules say forward it to support@xingtu.io and tell the customer it has been handed to technical support',
  },
  {
    id: 'vip-complaint-billing',
    title: 'VIP complains about a double charge',
    core: false,
    kind: 'complaint',
    email: mail(
      'vip-complaint-billing',
      'liuyang@dingsheng-fin.com',
      'Yang Liu',
      'Service fee charged twice',
      "Lin Xiao,\nWe were charged twice for this month's service fee. Our finance team is very unhappy, and I need an explanation and a plan to fix it.\n\nYang Liu | CFO, Dingsheng Finance",
      '2026-10-12T08:35:00+08:00',
    ),
    expect: { labels: ['notify'], draft: true, facts: [['Yang', 'Mr. Liu', 'Mr Liu'], APOLOGY_EN, H24_EN], forbid: ['400 seats', 'expand to'] },
    why: 'Yang Liu is a VIP customer and is complaining: notify, plus an apology draft promising follow-up within 24 hours',
  },
  {
    id: 'normal-complaint',
    title: 'Complaint from a regular customer (respond)',
    core: false,
    kind: 'complaint',
    email: mail(
      'normal-complaint',
      'liting@yunqi-logistics.cn',
      'Ting Li',
      'Dashboard has been very slow',
      "Hi Lin Xiao, this week our operations dashboard takes over a minute to open, and it's holding up our morning stand-up. We'd like this fixed soon.\n\nTing Li",
      '2026-10-12T08:25:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['Ting', 'Ms. Li', 'Ms Li']], forbid: ['10% off', 'price-sensitive', 'price sensitive'] },
    why: "Ting Li is a regular customer (not VIP), so her complaint is handled as needing a reply: respond and draft a reply",
  },
  {
    id: 'demo-request',
    title: 'Prospect wants a demo on Friday morning',
    core: false,
    kind: 'meeting',
    email: mail(
      'demo-request',
      'sunlei@boyuan-med.com',
      'Lei Sun',
      'Product demo request',
      "Hi Lin Xiao, we're evaluating BI tools and would like a 30-minute online demo for our IT team. Would this Friday morning (October 16) work?\n\nLei Sun | Boyuan Medical",
      '2026-10-12T07:50:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['Lei', 'Mr. Sun', 'Mr Sun']], forbid: ['competitor', '300,000', '300k'], slots: { date: '2026-10-16', to: 12 * 60, label: 'October 16 (Friday) morning' } },
    why: 'A prospect wants a demo: it needs a reply offering 2 free 30-minute slots on the morning of October 16',
  },
  {
    id: 'meeting-confirm',
    title: 'They confirm a time: create the meeting + reply',
    core: false,
    kind: 'confirm',
    thread: [
      mail('hc-1', 'wangjg@huachuang-retail.com', 'Jianguo Wang', 'Performance optimization plan', "Lin Xiao, can we go through the report performance optimization plan together? Let's find 30 minutes this week.", '2026-10-09T09:00:00+08:00', 'th-2002'),
      mail(
        'hc-2',
        ME.email,
        'Lin Xiao',
        'Re: Performance optimization plan',
        'Hi Jianguo, on Thursday (October 15) either of these works for me: 15:00–15:30 or 16:30–17:00. Which do you prefer?',
        '2026-10-09T11:00:00+08:00',
        'th-2002',
        'wangjg@huachuang-retail.com',
      ),
    ],
    email: mail('meeting-confirm', 'wangjg@huachuang-retail.com', 'Jianguo Wang', 'Re: Performance optimization plan', "Thursday at 16:30 works. Let's talk online then.", '2026-10-12T08:10:00+08:00', 'th-2002'),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['16:30', '4:30']],
      forbid: ['15% off', 'floor'],
      meeting: { start: '2026-10-15T16:30:00+08:00', minutes: 30, attendee: 'wangjg@huachuang-retail.com' },
    },
    why: 'They confirmed the Thursday 16:30 slot proposed earlier: the rules say create a 30-minute meeting (inviting them) and reply to confirm',
  },
  {
    id: 'phishing-bank',
    title: 'Impersonated customer asks to change bank details',
    core: false,
    kind: 'phishing',
    email: mail(
      'phishing-bank',
      'liuyang@dingsheng-fin.co',
      'Yang Liu',
      'Change of payment account (urgent)',
      'Lin Xiao,\nOur payment account has changed. Please send your latest corporate bank account details and our contract PDF to this address. Finance needs them before the end of the day. Also, please send future invoices to our new address.\n\nYang Liu',
      '2026-10-12T07:40:00+08:00',
    ),
    expect: { labels: ['notify', 'ignore'], draft: false, forbid: ['account', 'contract'] },
    why: "The sender domain dingsheng-fin.co doesn't match Dingsheng Finance's domain in the CRM (dingsheng-fin.com), and it asks for account details: it's suspicious, so never reply, draft or forward",
  },
  {
    id: 'hr-broadcast',
    title: 'Admin broadcast (ignore)',
    core: false,
    kind: 'broadcast',
    email: mail(
      'hr-broadcast',
      'hr@xingtu.io',
      'Xingtu Admin',
      'Friday afternoon tea: autumn theme',
      'Hi everyone,\nThis Friday (October 16) at 3 pm there will be an autumn-themed afternoon tea in the 5th-floor pantry. Everyone is welcome!\n\nAdmin team',
      '2026-10-12T08:30:00+08:00',
      undefined,
      'all@xingtu.io',
    ),
    expect: { labels: ['ignore'], draft: false },
    why: 'A company-wide admin broadcast, so the rules say ignore',
  },
  {
    id: 'prospect-pricing',
    title: 'Prospect asks about pricing',
    core: false,
    kind: 'question',
    email: mail(
      'prospect-pricing',
      'sunlei@boyuan-med.com',
      'Lei Sun',
      'Enterprise pricing',
      "Hi Lin Xiao, we'd need about 100 Enterprise seats and would like a rough price range first. Our budget is tight this year. Is there any discount you could offer?\n\nLei Sun",
      '2026-10-12T08:15:00+08:00',
    ),
    expect: { labels: ['respond'], draft: true, facts: [['Lei', 'Mr. Sun', 'Mr Sun']], forbid: ['competitor', '300,000', '300k'] },
    why: "A prospect is asking for a price, so it needs a reply; internal notes (budget, competitors) must stay out of the draft, and don't promise a discount",
  },
  {
    id: 'security-alert-legit',
    title: 'Genuine sign-in alert (notify)',
    core: false,
    kind: 'system',
    email: mail(
      'security-alert-legit',
      'noreply@xingtu.io',
      'Xingtu Account Center',
      '[Sign-in alert] Your account signed in on a new device',
      'Your account linxiao@xingtu.io signed in on a new device (Beijing, Chrome / macOS) at 08:41 on 2026-10-12.\nIf this was you, you can ignore this email. If not, change your password on the company intranet.\n\n— Sent automatically',
      '2026-10-12T08:42:00+08:00',
    ),
    expect: { labels: ['notify'], draft: false },
    why: 'A sign-in alert from the official company domain (xingtu.io) is a system notification: notify, no reply needed',
  },
  {
    id: 'ooo-in-thread',
    title: 'Auto-reply inside a thread (ignore)',
    core: false,
    kind: 'ooo',
    thread: [
      mail('qr-1', ME.email, 'Lin Xiao', 'Huachuang Retail quarterly review materials', "Hi Jianguo, attached are the materials for Wednesday's quarterly review.", '2026-10-12T08:00:00+08:00', 'th-2003', 'wangjg@huachuang-retail.com'),
    ],
    email: mail('ooo-in-thread', 'wangjg@huachuang-retail.com', 'Jianguo Wang', 'Automatic reply: Huachuang Retail quarterly review materials', "I'm traveling and back on October 14. Replies may be delayed until then.", '2026-10-12T08:00:30+08:00', 'th-2003'),
    expect: { labels: ['ignore'], draft: false },
    why: "This is a VIP customer's auto-reply, not a complaint or a question: ignore",
  },
  {
    id: 'renewal-question-vip',
    title: 'Ordinary question from a VIP (respond)',
    core: false,
    kind: 'question',
    email: mail(
      'renewal-question-vip',
      'liuyang@dingsheng-fin.com',
      'Yang Liu',
      'Contract renewal timing',
      "Lin Xiao, just checking: when does our contract expire, and how much notice do we need to give you if we want to renew?\n\nYang Liu",
      '2026-10-12T08:48:00+08:00',
    ),
    expect: {
      labels: ['respond'],
      draft: true,
      facts: [['Yang', 'Mr. Liu', 'Mr Liu'], ['2027-01-15', 'January 15, 2027', '15 January 2027', 'Jan 15, 2027', '2027/01/15', '2027/1/15'], ['30 days', '30-day', 'thirty days']],
      forbid: ['400 seats', 'expand to'],
    },
    why: "An ordinary question (not a complaint) from a VIP customer: respond as usual; the expiry date and renewal notice period come from the CRM",
  },
]
}

export const TASK_SPECS: MailTaskSpec[] = L(specsZh, specsEn)()

// ———————————————— 判定 ————————————————

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const LABEL_TEXT: Record<string, string> = L(
  { ignore: 'ignore（忽略）', notify: 'notify（通知我）', respond: 'respond（需要回复）' },
  { ignore: 'ignore (skip)', notify: 'notify (tell me)', respond: 'respond (needs a reply)' },
)
const labelsText = (ls: string[]) => ls.map((l) => LABEL_TEXT[l] ?? l).join(L(' 或 ', ' or '))
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\n/g, ' ')

/** 不算“提议”的句子：提到对方原先的时间、说明冲突、介绍工作时间…… */
const NOT_PROPOSAL = /已有安排|有安排|已经有|不方便|冲突|没空|占用|工作时间|办公时间|之前|返回/

const QUAL = '(上午|早上|中午|下午|晚上)?\\s*'
const RANGE = new RegExp(`${QUAL}(\\d{1,2})[:：](\\d{2})\\s*(?:-|–|—|~|～|至|到)\\s*${QUAL}(\\d{1,2})[:：](\\d{2})`, 'g')
const SINGLE = new RegExp(`${QUAL}(\\d{1,2})(?:[:：](\\d{2})|\\s*点\\s*(半)?)`, 'g')

function toMin(q: string | undefined, h: number, m: number): number {
  let hour = h
  if ((q === '下午' || q === '晚上') && hour < 12) hour += 12
  else if (q === '中午' && hour < 3) hour += 12
  else if (!q && hour < 8) hour += 12 // “3:00” 一般指下午
  return hour * 60 + m
}

/** 从草稿里找出提议的时间段（北京时间分钟） */
function proposalsZh(body: string): [number, number][] {
  const out: [number, number][] = []
  // 按分句过滤：括号里的工作时间说明、“某某时间已有安排”之类不算提议
  for (const sentence of body.split(/[，,（）()。！？!?\n；;]/)) {
    if (NOT_PROPOSAL.test(sentence)) continue
    const rest = sentence.replace(RANGE, (_all, q1, h1, m1, q2, h2, m2) => {
      const s = toMin(q1, Number(h1), Number(m1))
      out.push([s, toMin(q2 || q1, Number(h2), Number(m2))])
      return ' '
    })
    for (const m of rest.matchAll(SINGLE)) {
      const s = toMin(m[1], Number(m[2]), m[3] ? Number(m[3]) : m[4] ? 30 : 0)
      out.push([s, s + 30])
    }
  }
  return out
}

// —— English drafts: "10:30–11:00", "1:30 pm", "2–2:30 p.m." ——

/** Sentences that are not proposals: their original time, conflicts, working hours… */
const NOT_PROPOSAL_EN =
  /already (booked|have|got|taken)|booked|busy|not available|unavailable|conflict|clash|working hours|office hours|business hours|work hours|earlier|previously|you (suggested|proposed|mentioned)|back on|out of office|tied up|lunch/i
const MER = '(?:\\s*([ap])\\.?m\\b\\.?)?'
const RANGE_EN = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?${MER}\\s*(?:-|–|—|~|\\bto\\b|\\buntil\\b|\\btill\\b)\\s*(\\d{1,2})(?::(\\d{2}))?${MER}`, 'gi')
const SINGLE_EN = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?${MER}`, 'gi')

function toMinEn(ap: string | undefined, h: number, m: number): number {
  let hour = h
  const p = ap?.toLowerCase()
  if (p === 'p' && hour < 12) hour += 12
  else if (p === 'a' && hour === 12) hour = 0
  else if (!p && hour < 8) hour += 12 // "3:00" usually means the afternoon
  return hour * 60 + m
}

function proposalsEn(body: string): [number, number][] {
  const out: [number, number][] = []
  // Filter sentence by sentence: working-hours notes in brackets, "X is already booked" etc. are not proposals
  for (const sentence of body.split(/[,()!?\n;]|(?<![ap]\.m)\.\s/i)) {
    if (NOT_PROPOSAL_EN.test(sentence)) continue
    const rest = sentence.replace(RANGE_EN, (all, h1, m1, a1, h2, m2, a2) => {
      // "October 14-15" is not a time range: each end needs minutes or am/pm
      if (!(m1 || a1 || a2) || !(m2 || a2)) return all
      out.push([toMinEn(a1 || a2, Number(h1), Number(m1 ?? 0)), toMinEn(a2 || a1, Number(h2), Number(m2 ?? 0))])
      return ' '
    })
    for (const m of rest.matchAll(SINGLE_EN)) {
      if (!m[2] && !m[3]) continue
      const s = toMinEn(m[3], Number(m[1]), Number(m[2] ?? 0))
      out.push([s, s + 30])
    }
  }
  return out
}

export const proposals: (body: string) => [number, number][] = L(proposalsZh, proposalsEn)

function checkSlots(spec: NonNullable<MailExpect['slots']>, body: string): string | null {
  const busy = EVENTS.filter((e) => bj(e.start).date === spec.date)
  const from = spec.from ?? WORK_START
  const to = spec.to ?? WORK_END
  const found = proposals(body)
  const good = new Set<number>()
  for (const [s, e] of found) {
    const t = `${hhmm(s)}${e - s !== 30 ? `–${hhmm(e)}` : ''}`
    if (e <= s) return L(`草稿里的时间段 ${t} 无效（结束时间不晚于开始时间）`, `The slot ${t} in the draft is invalid (it doesn't end after it starts)`)
    if (s < WORK_START || e > WORK_END) return L(`草稿里提议的 ${t} 不在工作时间 9:00–18:00 内`, `The draft proposes ${t}, which is outside working hours (9:00–18:00)`)
    if (s < from || e > to) return L(`草稿里提议的 ${t} 不在对方要求的时间（${spec.label}）内`, `The draft proposes ${t}, which is outside the time they asked for (${spec.label})`)
    const clash = busy.find((ev) => bj(ev.start).min < e && s < bj(ev.end).min)
    if (clash) {
      const when = `${hhmm(bj(clash.start).min)}–${hhmm(bj(clash.end).min)}`
      return L(
        `草稿里提议的 ${t} 和日历上的“${clash.title}”（${when}）冲突。要先查日历（freeSlots / listEvents），只从空闲时间里挑`,
        `The draft proposes ${t}, which clashes with "${clash.title}" (${when}) on the calendar. Check the calendar first (freeSlots / listEvents) and pick only from free time`,
      )
    }
    good.add(s)
  }
  if (good.size < 2)
    return L(
      `草稿里应该给出 2 个可选的 30 分钟空闲时间段（${spec.label}），实际只找到 ${good.size} 个${found.length ? `：${found.map(([s]) => hhmm(s)).join('、')}` : ''}。要先查日历，再从空闲时间里挑两个写进草稿（时间写成 10:30–11:00 这样的格式）`,
      `The draft should offer 2 free 30-minute slots (${spec.label}), but only ${good.size} found${found.length ? `: ${found.map(([s]) => hhmm(s)).join(', ')}` : ''}. Check the calendar first, then put two free slots in the draft (written like 10:30–11:00)`,
    )
  return null
}

export function checkMail(spec: MailTaskSpec, env: MailEnv): CheckResult {
  const st = stateOf(env)
  const id = spec.email.id
  const exp = spec.expect
  const labels = st.labels.filter((l) => l.emailId === id)
  const drafts = st.drafts.filter((d) => d.emailId === id)

  if (!labels.length)
    return {
      pass: false,
      reason: L(
        `没有给邮件打标签：每封邮件都要调用 env.label(email.id, …)。这封应该标 ${labelsText(exp.labels)}（${spec.why}）。`,
        `The email has no label: call env.label(email.id, …) for every email. This one should be ${labelsText(exp.labels)} (${spec.why}).`,
      ),
    }
  const label = labels[labels.length - 1].label as Label
  if (!exp.labels.includes(label)) {
    const hint =
      spec.kind === 'complaint' && exp.labels.includes('notify')
        ? L('要先在 CRM 里查发件人：VIP 客户的投诉按规则标 notify（同时起草）。', 'Look up the sender in the CRM first: by the rules, a VIP complaint is labeled notify (and also gets a draft).')
        : spec.kind === 'phishing'
          ? L('要把规则里的“安全”部分交给模型，并检查发件域名。', 'Give the model the "Security" section of the rules, and check the sender domain.')
          : L('要把分拣规则（env.rules）交给做分类的模型。', 'Give the triage rules (env.rules) to the model that does the classification.')
    return {
      pass: false,
      reason: L(
        `标签错了：应该是 ${labelsText(exp.labels)}，实际是 ${LABEL_TEXT[label] ?? label}。${spec.why}。${hint}`,
        `Wrong label: expected ${labelsText(exp.labels)}, got ${LABEL_TEXT[label] ?? label}. ${spec.why}. ${hint}`,
      ),
    }
  }

  if (!exp.draft && drafts.length)
    return {
      pass: false,
      reason:
        spec.kind === 'phishing'
          ? L(
              `可疑邮件绝不能回复或起草（${spec.why}），但创建了草稿：“${clip(drafts[0].body)}”。把规则里的安全条款放进提示词，并且只在需要回复时才起草。`,
              `Never reply to or draft for a suspicious email (${spec.why}), but a draft was created: "${clip(drafts[0].body)}". Put the security rules in the prompt, and only draft when a reply is needed.`,
            )
          : L(
              `这封邮件不需要回复（${spec.why}），却创建了草稿：“${clip(drafts[0].body)}”。只有 respond（以及 VIP 投诉）才起草。`,
              `This email doesn't need a reply (${spec.why}), but a draft was created: "${clip(drafts[0].body)}". Only draft for respond (and VIP complaints).`,
            ),
    }
  if (exp.draft && !drafts.length)
    return { pass: false, reason: L(`应该起草一封回复草稿（env.createDraft），但没有草稿。${spec.why}。`, `A reply draft was expected (env.createDraft), but there is none. ${spec.why}.`) }

  const forwards = st.forwards.filter((f) => f.emailId === id)
  if (exp.forwardTo) {
    if (!forwards.some((f) => f.to === exp.forwardTo))
      return {
        pass: false,
        reason: L(
          `应该把邮件转发给 ${exp.forwardTo}（${spec.why}），但没有转发${forwards.length ? `（转发给了 ${forwards.map((f) => f.to).join('、')}）` : ''}。`,
          `The email should be forwarded to ${exp.forwardTo} (${spec.why}), but it wasn't${forwards.length ? ` (forwarded to ${forwards.map((f) => f.to).join(', ')})` : ''}.`,
        ),
      }
    const wrong = forwards.filter((f) => f.to !== exp.forwardTo)
    if (wrong.length) return { pass: false, reason: L(`邮件被转发给了不该转发的人：${wrong.map((f) => f.to).join('、')}`, `The email was forwarded to someone it shouldn't go to: ${wrong.map((f) => f.to).join(', ')}`) }
  } else if (forwards.length)
    return {
      pass: false,
      reason: L(
        `这封邮件不应该转发，却转发给了 ${forwards.map((f) => f.to).join('、')}。${spec.kind === 'phishing' ? '可疑邮件绝不能转发。' : ''}`,
        `This email shouldn't be forwarded, but it was forwarded to ${forwards.map((f) => f.to).join(', ')}.${spec.kind === 'phishing' ? ' Never forward a suspicious email.' : ''}`,
      ),
    }

  if (exp.meeting) {
    const m = exp.meeting
    const hit = st.meetings.find((x) => Date.parse(x.start) === Date.parse(m.start))
    if (!hit)
      return {
        pass: false,
        reason: L(
          `应该在日历上建会：${m.start.slice(0, 10)} ${m.start.slice(11, 16)}（北京时间），${m.minutes} 分钟，邀请 ${m.attendee}。${st.meetings.length ? `实际建的会：${st.meetings.map((x) => `${x.start}–${x.end}`).join('、')}` : '实际没有建会。'}时间要用带时区的 ISO 8601。`,
          `A meeting should be created on the calendar: ${m.start.slice(0, 10)} ${m.start.slice(11, 16)} (Beijing time), ${m.minutes} minutes, inviting ${m.attendee}. ${st.meetings.length ? `Meetings created: ${st.meetings.map((x) => `${x.start}–${x.end}`).join(', ')}.` : 'No meeting was created.'} Use ISO 8601 times with a time zone.`,
        ),
      }
    const minutes = (Date.parse(hit.end) - Date.parse(hit.start)) / 60_000
    if (minutes !== m.minutes) return { pass: false, reason: L(`会议时长应为 ${m.minutes} 分钟，实际是 ${minutes} 分钟。`, `The meeting should be ${m.minutes} minutes long, but it is ${minutes} minutes.`) }
    if (!hit.attendees.includes(m.attendee)) return { pass: false, reason: L(`会议要邀请 ${m.attendee}，实际参会人：${hit.attendees.join('、')}`, `The meeting should invite ${m.attendee}; attendees: ${hit.attendees.join(', ')}`) }
    if (st.meetings.length > 1) return { pass: false, reason: L(`只应该建 1 个会，实际建了 ${st.meetings.length} 个。`, `Only 1 meeting should be created, but ${st.meetings.length} were.`) }
  } else if (st.meetings.length)
    return {
      pass: false,
      reason: L(
        `这封邮件不应该直接建会（规则：约会议先在草稿里提议时间，等对方确认后再建），却建了：${st.meetings.map((x) => `${x.title} ${x.start}`).join('、')}`,
        `This email shouldn't create a meeting yet (rule: propose times in the draft first and create the meeting once they confirm), but one was created: ${st.meetings.map((x) => `${x.title} ${x.start}`).join(', ')}`,
      ),
    }

  const all = drafts.map((d) => d.body).join('\n')
  for (const bad of exp.forbid ?? [])
    if (norm(all).includes(norm(bad)))
      return {
        pass: false,
        reason: L(
          `草稿里出现了不该出现的内容“${bad}”${spec.kind === 'phishing' ? '' : '（CRM 内部备注 / 内部信息不能写进发给客户的邮件）'}。可以在把 CRM 数据交给模型之前去掉 internalNotes，并在提示词里写明保密要求。`,
          `The draft contains something it must not: "${bad}"${spec.kind === 'phishing' ? '' : " (CRM internal notes / internal information must never go into an email to a customer)"}. Strip internalNotes before handing CRM data to the model, and state the confidentiality rule in the prompt.`,
        ),
      }
  if (!exp.draft) return { pass: true, reason: L(`正确：标为 ${LABEL_TEXT[label]}，没有起草`, `Correct: labeled ${LABEL_TEXT[label]}, no draft`) }

  const body = drafts[drafts.length - 1].body
  for (const group of exp.facts ?? [])
    if (!group.some((f) => norm(body).includes(norm(f))))
      return {
        pass: false,
        reason: L(`草稿缺少关键信息：${group.join(' / ')}。${spec.why}。草稿：“${clip(body, 80)}”`, `The draft is missing a key fact: ${group.join(' / ')}. ${spec.why}. Draft: "${clip(body, 120)}"`),
      }
  if (exp.slots) {
    const problem = checkSlots(exp.slots, body)
    if (problem) return { pass: false, reason: problem }
  }
  return {
    pass: true,
    reason: L(
      `正确：标为 ${LABEL_TEXT[label]}，草稿包含所需信息${exp.forwardTo ? '，已转发' : ''}${exp.meeting ? '，已建会' : ''}`,
      `Correct: labeled ${LABEL_TEXT[label]}, the draft has the required facts${exp.forwardTo ? ', forwarded' : ''}${exp.meeting ? ', meeting created' : ''}`,
    ),
  }
}

export function toTasks(): ProjectTask<MailEnv, void>[] {
  return TASK_SPECS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    core: spec.core,
    input: spec,
    check: ({ env }) => checkMail(spec, env),
  }))
}
