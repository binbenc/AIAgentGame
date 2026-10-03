import type { CheckResult, ProjectTask } from '../types'
import { HELP_DOCS } from './docs'

export interface HelpAnswer {
  answer: string
  citations: string[]
  refused: boolean
}

export interface QA {
  id: string
  title: string
  core: boolean
  question: string
  /** answer：资料里有答案；unknown：领域内但资料里没有；offtopic：与产品无关 */
  kind: 'answer' | 'unknown' | 'offtopic'
  /** 必须出现的事实：每组里任意一个写法出现即可 */
  facts?: string[][]
  /** 必须引用的文档 id */
  docs?: string[]
  /** 陷阱：过时文档里的错误事实 */
  avoid?: { fact: string; doc: string }
}

const q = (x: QA) => x

export const QAS: QA[] = [
  // ———— 核心任务（模拟模型可解，参与评星） ————
  q({ id: 'free-storage', title: '单一事实', core: true, kind: 'answer', question: '免费版有多少存储空间？', facts: [['20GB', '20 GB']], docs: ['plan-free'] }),
  q({ id: 'price-conflict', title: '新旧文档冲突', core: true, kind: 'answer', question: '专业版现在每月多少钱？', facts: [['30 元', '30元', '¥30']], docs: ['pricing-2026'], avoid: { fact: '25', doc: 'pricing-2024' } }),
  q({ id: 'share-multi', title: '跨文档综合', core: true, kind: 'answer', question: '分享链接最长能设置多久？企业版能不能设成永久？', facts: [['30 天', '30天'], ['永久']], docs: ['share-links', 'plan-enterprise'] }),
  q({ id: 'reset-password', title: '操作步骤', core: true, kind: 'answer', question: '忘记密码了怎么办？', facts: [['验证码'], ['忘记密码']], docs: ['account-reset'] }),
  q({ id: 'web-upload', title: '易混淆数值', core: true, kind: 'answer', question: '网页端上传单个文件最大多少？', facts: [['4GB', '4 GB']], docs: ['upload-limits'] }),
  q({ id: 'recycle-restore', title: '口语化提问', core: true, kind: 'answer', question: '我不小心删了文件，还能找回来吗？专业版能保留多久？', facts: [['回收站'], ['90 天', '90天']], docs: ['recycle-bin'] }),
  q({ id: 'datacenter-city', title: '资料里没有的信息', core: true, kind: 'unknown', question: '你们的数据中心在哪个城市？' }),
  q({ id: 'poem', title: '超出范围', core: true, kind: 'offtopic', question: '帮我写一首关于春天的诗' }),

  // ———— 完整任务集（真实模型基准） ————
  q({ id: 'team-size', title: '团队版人数', core: false, kind: 'answer', question: '团队版最多能有多少成员？', facts: [['500']], docs: ['plan-team'] }),
  q({ id: 'team-price', title: '团队版价格（新旧冲突）', core: false, kind: 'answer', question: '团队版现在多少钱一个人？', facts: [['45']], docs: ['pricing-2026'], avoid: { fact: '40 元', doc: 'pricing-2024' } }),
  q({ id: 'refund-renew', title: '续费退款', core: false, kind: 'answer', question: '我是续费的会员，可以退款吗？', facts: [['不支持', '不能', '无法']], docs: ['refund'] }),
  q({ id: 'invoice-special', title: '专票', core: false, kind: 'answer', question: '开增值税专用发票需要什么材料？多久能审核完？', facts: [['营业执照'], ['1 到 2 个工作日', '1-2 个工作日', '1~2 个工作日', '1到2个工作日']], docs: ['invoice'] }),
  q({ id: 'ios-renew', title: 'App Store 续费', core: false, kind: 'answer', question: '我在 iPhone 上买的会员，怎么关掉自动续费？', facts: [['Apple ID', 'apple id', 'Apple ID'], ['订阅']], docs: ['auto-renew'] }),
  q({ id: 'speed-limit', title: '限速', core: false, kind: 'answer', question: '免费用户下载会被限速吗？', facts: [['不限速']], docs: ['download-speed'] }),
  q({ id: 'offline-quota', title: '离线下载', core: false, kind: 'answer', question: '离线下载每天能加多少个任务？免费版能用吗？', facts: [['50'], ['专业版']], docs: ['offline-download'] }),
  q({ id: 'sync-conflict', title: '同步冲突', core: false, kind: 'answer', question: '两台电脑同时改了同一个文件，同步时会怎样？', facts: [['冲突副本']], docs: ['sync-folder'] }),
  q({ id: 'share-daily', title: '分享上限', core: false, kind: 'answer', question: '一天最多能建多少个分享链接？', facts: [['200']], docs: ['share-limits'] }),
  q({ id: 'collab-space', title: '共享文件夹空间', core: false, kind: 'answer', question: '共享文件夹占谁的空间？最多能邀请几个人？', facts: [['创建者'], ['50']], docs: ['collab-folder'] }),
  q({ id: 'macro-edit', title: '在线编辑限制', core: false, kind: 'answer', question: '带宏的 Excel 能在线编辑吗？', facts: [['不支持', '不能']], docs: ['online-edit'] }),
  q({ id: 'version-days', title: '历史版本', core: false, kind: 'answer', question: '免费版的历史版本能保留多久？', facts: [['30 天', '30天']], docs: ['version-history'] }),
  q({ id: 'fulltext', title: '全文搜索', core: false, kind: 'answer', question: '能搜索 PDF 里面的文字吗？', facts: [['专业版'], ['全文']], docs: ['search-files'] }),
  q({ id: 'lockout', title: '验证码锁定', core: false, kind: 'answer', question: '验证码输错几次会被锁？锁多久？', facts: [['5 次', '5次'], ['30 分钟', '30分钟']], docs: ['account-reset'] }),
  q({ id: 'vault-forgot', title: '保险箱密码', core: false, kind: 'answer', question: '隐私保险箱的密码忘了怎么办？', facts: [['人工客服']], docs: ['private-vault'] }),
  q({ id: 'delete-cooloff', title: '注销冷静期', core: false, kind: 'answer', question: '注销账号后还能反悔吗？', facts: [['15 天', '15天'], ['登录']], docs: ['account-delete'] }),
  q({ id: 'linux', title: 'Linux 客户端', core: false, kind: 'answer', question: '有 Linux 客户端吗？', facts: [['WebDAV', '网页版']], docs: ['clients'] }),
  q({ id: 'webdav-password', title: 'WebDAV 密码', core: false, kind: 'answer', question: 'WebDAV 用登录密码登不上是怎么回事？', facts: [['应用密码']], docs: ['webdav'] }),
  q({ id: 'api-429', title: 'API 限额', core: false, kind: 'answer', question: '调用开放平台接口总是返回 429，限额是多少？', facts: [['600']], docs: ['api-limits'] }),
  q({ id: 'student-discount', title: '学生优惠', core: false, kind: 'answer', question: '学生买专业版有优惠吗？', facts: [['5 折', '五折', '5折']], docs: ['student'] }),
  q({ id: 'ceo-name', title: '资料没有（公司）', core: false, kind: 'unknown', question: '极光网盘的 CEO 是谁？' }),
  q({ id: 'weather', title: '超出范围（天气）', core: false, kind: 'offtopic', question: '明天北京下雨吗？' }),
]

const DOC_IDS = new Set(HELP_DOCS.map((d) => d.id))
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const docOf = (c: string) => String(c).split('#')[0]

export function checkAnswer(qa: QA, out: HelpAnswer | undefined, llmCalls: number): CheckResult {
  if (!out || typeof out.answer !== 'string' || !Array.isArray(out.citations) || typeof out.refused !== 'boolean')
    return { pass: false, reason: '返回值格式不对：应为 { answer: string, citations: string[], refused: boolean }' }
  const cited = [...new Set(out.citations.map(docOf))]
  const fake = cited.filter((d) => !DOC_IDS.has(d))
  if (fake.length) return { pass: false, reason: `引用了不存在的文档：${fake.join(', ')}（引用要经过校验）` }

  if (qa.kind !== 'answer') {
    if (!out.refused) return { pass: false, reason: `资料里没有答案${qa.kind === 'offtopic' ? '（问题与产品无关）' : ''}，应该拒答（refused: true），而不是编一个答案：“${out.answer.slice(0, 60)}”` }
    if (cited.length) return { pass: false, reason: '拒答时不应附带引用' }
    if (qa.kind === 'offtopic' && llmCalls > 0) return { pass: false, reason: `与产品无关的问题不应该调用模型（调用了 ${llmCalls} 次）：检索得分太低时直接拒答，省钱也更安全` }
    return { pass: true, reason: '正确拒答' }
  }
  if (out.refused) return { pass: false, reason: '资料里有答案，却拒答了（检查检索是否召回了正确的文档）' }
  const text = norm(out.answer)
  for (const group of qa.facts ?? [])
    if (!group.some((f) => text.includes(norm(f)))) return { pass: false, reason: `回答缺少关键信息：${group.join(' / ')}。回答：“${out.answer.slice(0, 80)}”` }
  const missing = (qa.docs ?? []).filter((d) => !cited.includes(d))
  if (missing.length) return { pass: false, reason: `缺少必要的引用：${missing.join(', ')}（实际引用：${cited.join(', ') || '无'}）` }
  if (qa.avoid && (cited.includes(qa.avoid.doc) || text.includes(norm(qa.avoid.fact))))
    return { pass: false, reason: `用了过时的文档 ${qa.avoid.doc}（更新日期更早），信息已经失效。要把文档的更新日期交给模型，并要求以最新的为准` }
  return { pass: true, reason: '回答正确，引用正确' }
}

export function toTasks(): ProjectTask<{ docs: typeof HELP_DOCS }, HelpAnswer>[] {
  return QAS.map((qa) => ({
    id: qa.id,
    title: qa.title,
    core: qa.core,
    input: qa.question,
    check: ({ output, trace }) => checkAnswer(qa, output, trace.llmCalls().length),
  }))
}
