import { wrapUntrusted } from '../../guardrails'
import type { Tool } from '../../tools'
import type { WebEnv } from './main'

const TYPE_LABEL: Record<string, string> = { official: '官方', news: '新闻', blog: '博客', forum: '论坛' }

/** 把“互联网”包装成两个工具：搜索（只给摘要）+ 打开网页（全文，标记为不可信）。fetched 记录真正读过的网址，用来校验引用。 */
export function createWebTools(web: WebEnv, fetched: Set<string>): Tool[] {
  return [
    {
      spec: {
        name: 'search_web',
        description: '搜索网页，返回标题、网址、发布日期、来源类型和摘要。摘要不是全文，关键事实要用 fetch_page 打开网页确认。',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索关键词，例如 "青岚储能 2025 年报 出货量"' } },
          required: ['query'],
        },
      },
      run: async ({ query }) => {
        const hits = await web.search(String(query), 5)
        if (!hits.length) return '没有搜索结果，换个关键词试试。'
        return hits
          .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.date} · ${TYPE_LABEL[h.sourceType] ?? h.sourceType} · ${h.site}\n   ${h.snippet}`)
          .join('\n')
      },
    },
    {
      spec: {
        name: 'fetch_page',
        description: '打开一个网页，返回全文和元数据（发布日期、来源类型）。只能打开搜索结果里出现过的网址。',
        input_schema: { type: 'object', properties: { url: { type: 'string', description: '网页网址' } }, required: ['url'] },
      },
      run: async ({ url }) => {
        const p = await web.fetch(String(url))
        fetched.add(p.url)
        const meta = `网址：${p.url}\n标题：${p.title}\n发布日期：${p.date}\n来源类型：${TYPE_LABEL[p.sourceType] ?? p.sourceType}（${p.site}）`
        // 网页正文是外部内容：包进 <untrusted>，配合 system 里的 UNTRUSTED_POLICY，防止提示注入
        return `${meta}\n${wrapUntrusted(p.url, p.text)}`
      },
    },
  ]
}
