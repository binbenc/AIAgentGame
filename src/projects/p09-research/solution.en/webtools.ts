import { wrapUntrusted } from '../../guardrails'
import type { Tool } from '../../tools'
import type { WebEnv } from './main'

/** Wrap the "internet" as two tools: search (snippets only) + open page (full text, marked untrusted). `fetched` records the URLs actually read, for citation checks. */
export function createWebTools(web: WebEnv, fetched: Set<string>): Tool[] {
  return [
    {
      spec: {
        name: 'search_web',
        description:
          'Search the web. Returns title, URL, publication date, source type and a snippet. Snippets are not the full text: confirm key facts by opening the page with fetch_page.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search keywords, e.g. "Qinglan Energy Storage 2025 annual report shipments"' } },
          required: ['query'],
        },
      },
      run: async ({ query }) => {
        const hits = await web.search(String(query), 5)
        if (!hits.length) return 'No results. Try different keywords.'
        return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.date} · ${h.sourceType} · ${h.site}\n   ${h.snippet}`).join('\n')
      },
    },
    {
      spec: {
        name: 'fetch_page',
        description: 'Open a web page and return its full text with metadata (publication date, source type). Only URLs that appeared in search results can be opened.',
        input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Page URL' } }, required: ['url'] },
      },
      run: async ({ url }) => {
        const p = await web.fetch(String(url))
        fetched.add(p.url)
        const meta = `URL: ${p.url}\nTitle: ${p.title}\nPublished: ${p.date}\nSource type: ${p.sourceType} (${p.site})`
        // Page text is external content: wrap it in <untrusted> and pair it with UNTRUSTED_POLICY in the system prompt to block prompt injection
        return `${meta}\n${wrapUntrusted(p.url, p.text)}`
      },
    },
  ]
}
