import { chat, textOf } from 'agent-quest'
// 提示：前面关卡写好的代码可以直接复用
// import { runAgent } from '../../agent'                     // Agent 循环（第 4 关）
// import type { Tool } from '../../tools'                    // 工具接口（第 3 关）
// import { research as fanOut } from '../../agents/orchestrator' // 编排者-工作者（第 14 关）
// import { UNTRUSTED_POLICY, wrapUntrusted } from '../../guardrails' // 不可信内容标记（第 17 关）

/** 搜索结果：只有标题和摘要，没有全文 */
export interface SearchHit {
  url: string
  title: string
  /** 摘要（不是全文：关键事实往往不在这里） */
  snippet: string
  /** 发布日期 YYYY-MM-DD */
  date: string
  /** official 官方 / news 新闻 / blog 博客 / forum 论坛 */
  sourceType: 'official' | 'news' | 'blog' | 'forum'
  site: string
}

/** fetch 返回的网页全文 */
export interface WebPage {
  url: string
  title: string
  date: string
  sourceType: 'official' | 'news' | 'blog' | 'forum'
  site: string
  text: string
}

/** 环境提供的“互联网”（原始 API）。怎么包装成给模型用的工具，由你决定。 */
export interface WebEnv {
  /** 关键词搜索，返回前 k 条（默认 5，最多 10） */
  search(query: string, k?: number): Promise<SearchHit[]>
  /** 打开网页，返回全文；网址不存在时抛错 */
  fetch(url: string): Promise<WebPage>
}

export interface ResearchAnswer {
  /** 给客户的答案（中文） */
  answer: string
  /** 支撑答案的证据网址（必须是真正打开过的网页） */
  sources: string[]
}

/**
 * 深度研究的入口：回答一个需要查资料的问题，并给出证据网址。
 * 这是一个“项目”：没有 TODO 清单，架构由你决定。先读需求文档，再看任务列表。
 */
export async function research(question: string, web: WebEnv): Promise<ResearchAnswer> {
  // 最朴素的版本：搜一次，把搜索摘要交给模型直接回答，搜索结果全部当作来源。
  // 不打开网页、不做多跳、不管来源可不可信——试试看它能拿几分。
  const hits = await web.search(question, 5)
  const context = hits.map((h) => `${h.title}\n${h.snippet}\n${h.url}`).join('\n\n')
  const res = await chat({ messages: [{ role: 'user', content: `${context}\n\n问题：${question}` }] })
  return { answer: textOf(res.content), sources: hits.map((h) => h.url) }
}
