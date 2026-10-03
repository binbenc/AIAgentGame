/**
 * P9 的环境：一个本地的“互联网”。
 * - search(query, k)：BM25（中文按二元组切词）× 网页热度，返回标题、摘要、网址、日期、来源类型；
 * - fetch(url)：返回网页全文；不存在的网址抛 404。
 * 每次调用都经过 ctx.traced（记录到 trace）和 ctx.delay（模拟网络延迟）。
 * 环境会记下玩家真正打开过哪些网页：判定器要求“引用的网页必须读过”。
 */
import type { EnvCtx } from '../../types'
import { PAGES, type SourceType, type WebPageData } from './pages'

export interface SearchHit {
  url: string
  title: string
  /** 搜索结果摘要（不是全文） */
  snippet: string
  /** 发布日期 YYYY-MM-DD */
  date: string
  sourceType: SourceType
  site: string
}

export interface WebPage {
  url: string
  title: string
  date: string
  sourceType: SourceType
  site: string
  text: string
}

export interface WebEnv {
  search(query: string, k?: number): Promise<SearchHit[]>
  fetch(url: string): Promise<WebPage>
}

interface WebState {
  fetched: Set<string>
}

const STATES = new WeakMap<WebEnv, WebState>()
export const fetchedUrls = (env: WebEnv): Set<string> => STATES.get(env)?.fetched ?? new Set()

export const normUrl = (u: string) =>
  String(u ?? '')
    .trim()
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^http:\/\//, 'https://')

const BY_URL = new Map(PAGES.map((p) => [normUrl(p.url), p]))
export const pageOf = (url: string): WebPageData | undefined => BY_URL.get(normUrl(url))

// —————————— 检索：二元组 BM25 ——————————

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const [run] of text.toLowerCase().matchAll(/[a-z0-9.+%-]+|[一-鿿]+/g)) {
    if (/^[a-z0-9]/.test(run) || run.length === 1) out.push(run)
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  return out
}

interface Indexed {
  page: WebPageData
  tf: Map<string, number>
  len: number
}

const INDEX: Indexed[] = PAGES.map((page) => {
  // 标题权重加倍：搜索引擎通常更看重标题
  const terms = [...tokenize(page.title), ...tokenize(page.title), ...tokenize(page.summary), ...tokenize(page.text)]
  const tf = new Map<string, number>()
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
  return { page, tf, len: terms.length }
})
const DF = new Map<string, number>()
for (const d of INDEX) for (const t of d.tf.keys()) DF.set(t, (DF.get(t) ?? 0) + 1)
const AVG = INDEX.reduce((n, d) => n + d.len, 0) / INDEX.length

export function searchPages(query: string, k = 5): SearchHit[] {
  const terms = [...new Set(tokenize(query))]
  const N = INDEX.length
  const k1 = 1.2
  const b = 0.75
  return INDEX.map((d) => {
    let s = 0
    for (const t of terms) {
      const f = d.tf.get(t)
      if (!f) continue
      const n = DF.get(t) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / AVG))
    }
    return { d, score: s * (1 + (d.page.boost ?? 0) * 0.25) }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(10, Math.floor(k) || 5)))
    .map(({ d: { page } }) => ({ url: page.url, title: page.title, snippet: page.summary, date: page.date, sourceType: page.sourceType, site: page.site }))
}

const NAV: Record<string, string> = {
  official: '首页 | 关于我们 | 产品与服务 | 新闻中心 | 投资者关系 | 加入我们 | 联系我们',
  news: '首页 | 要闻 | 产业 | 公司 | 人物 | 财经 | 科技 | 视频 | 专题 | 登录 / 注册',
  blog: '首页 | 评测 | 观点 | 深度 | 访谈 | 工具箱 | 订阅 | 关于本站',
  forum: '论坛首页 › 版块列表 › 行业讨论 | 发帖 | 搜索 | 消息 | 登录',
}

/** 真实网页不只有正文：导航、相关阅读、页脚、版权声明……这些噪音也会占用上下文 */
function render(page: WebPageData): string {
  const related = PAGES.filter((x) => x.site === page.site && x.url !== page.url).slice(0, 4)
  return [
    `${page.site}  ${NAV[page.sourceType]}`,
    `当前位置：首页 › ${page.title}`,
    page.text,
    related.length ? `相关阅读：\n${related.map((x) => `· ${x.title}（${x.date}）`).join('\n')}` : '',
    `分享到：微信 | 微博 | 复制链接　　　　评论（0）　收藏　举报`,
    `版权所有 © ${page.site}　未经授权禁止转载　本站部分内容来源于网络，如有侵权请联系删除　澜ICP备 2016${page.url.length}88 号　客服热线 400-800-${page.url.length}00　违法和不良信息举报中心`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function createWebEnv(ctx: EnvCtx): WebEnv {
  const state: WebState = { fetched: new Set() }
  const env: WebEnv = {
    search: ctx.traced('search', async (query: string, k?: number) => {
      await ctx.delay(300)
      return searchPages(String(query ?? ''), k ?? 5)
    }),
    fetch: ctx.traced('fetch', async (url: string) => {
      await ctx.delay(500)
      const page = pageOf(String(url ?? ''))
      if (!page) throw new Error(`404：网页不存在（${url}）。只能打开搜索结果里出现过的网址。`)
      state.fetched.add(page.url)
      const { url: u, title, date, sourceType, site } = page
      return { url: u, title, date, sourceType, site, text: render(page) }
    }),
  }
  STATES.set(env, state)
  return env
}
