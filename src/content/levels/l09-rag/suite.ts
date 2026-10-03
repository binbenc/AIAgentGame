import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { say, visibleText } from '../../../engine/llm/mock-kit'
import { estimateTokens, requestTokens } from '../../../engine/llm/tokens'
import { NOVA_DOCS, type Doc } from '../../shared/docs'

type Chunk = { id: string; docId: string; index: number; text: string }
type Index = { search(query: string, k?: number): { chunk: Chunk; score: number }[] }
type Answer = { answer: string; citations: string[] }
type Mod = {
  chunk(doc: Doc, opts: { size: number; overlap: number }): Chunk[]
  buildIndex(docs: Doc[], opts?: { size: number; overlap: number }): Index
  answerWithCitations(question: string, index: Index, opts?: { k?: number; minScore?: number }): Promise<Answer>
}

interface QA {
  q: string
  /** 答案所在的原文片段：只有它出现在 prompt 里，模型才“知道”答案 */
  needle?: string
  answer?: string
  /** 模型凭空编出来的出处 */
  fake?: string
  hallucination?: string
}

const QAS: Record<string, QA> = {
  cited: { q: '智能门锁 L2 没电了怎么开门？', needle: 'Type-C 应急供电', answer: '可以用充电宝连接锁体底部的 Type-C 应急供电口临时供电，再用指纹或密码开门。' },
  fake: { q: '扫地机器人 R5 的保修期是多久？', needle: 'R5 整机保修 2 年', answer: 'R5 整机保修 2 年，电池保修 1 年。', fake: 'faq-warranty#9' },
  missing: { q: '智能空调 X1 能接入苹果 HomeKit 吗？', hallucination: '可以的，X1 支持直接接入苹果 HomeKit，用 Siri 就能控制。' },
}
const OUT_OF_SCOPE = '帮我写一首关于秋天的诗'

const CITE_ID = /[a-z0-9]+(?:-[a-z0-9]+)*#\d+/g

export const suite: LevelSuite = {
  budgets: { calls: 3, tokens: 1830 },
  mock(req) {
    const text = visibleText(req)
    const qa = Object.values(QAS).find((x) => text.includes(x.q))
    if (!qa) return say('您好，请问有什么可以帮您？')
    const ids = [...text.matchAll(CITE_ID)]
    const wantsCite = ids.length > 0 && /引用|标注|出处|来源|cite/i.test(text)
    const mayRefuse = /不知道|没有相关|无法回答|不要编造|不确定|找不到|没有答案/.test(text)

    const at = qa.needle ? text.indexOf(qa.needle) : -1
    if (at >= 0) {
      // 出处 = 答案片段前面最近的那个块 id
      const id = ids.filter((m) => m.index! < at).at(-1)?.[0]
      let out = qa.answer!
      if (wantsCite && id) out += ` [${id}]`
      if (wantsCite && qa.fake) out += ` [${qa.fake}]`
      return say(out)
    }
    if (mayRefuse) return say('抱歉，资料中没有相关信息，建议联系人工客服确认。')
    // 没有资料、也没被要求“不知道就说不知道”：模型会一本正经地编
    return say((qa.hallucination ?? '应该是可以的。') + (wantsCite && ids[0] ? ` [${ids[0][0]}]` : ''))
  },
  scenarios: [
    {
      id: 'retrieval-unit',
      title: '切块与检索（单元测试）',
      async run(ctx: ScenarioCtx) {
        const { chunk, buildIndex } = ctx.load<Mod>('rag.ts')
        const text = Array.from({ length: 25 }, (_, i) => `第${String(i).padStart(2, '0')}段的示例内容。`).join('')
        const cs = chunk({ id: 'demo', title: '演示', text }, { size: 100, overlap: 20 })
        ctx.eq(cs.map((c) => c.id), ['demo#0', 'demo#1', 'demo#2'], `${text.length} 字、size=100、overlap=20：应切成 3 块，id 形如 "文档id#块编号"`)
        ctx.eq(cs[1].text, text.slice(80, 180), '第 2 块应从第 80 个字符开始（步长 = size - overlap），和上一块重叠 20 个字符')
        ctx.assert(cs.every((c) => c.text.length <= 100 && c.docId === 'demo'), '每块不超过 size，并记录 docId')
        ctx.assert(cs[cs.length - 1].text.endsWith(text.slice(-10)), '最后一块要覆盖到文档末尾')
        ctx.eq(chunk({ id: 's', title: '短', text: '很短的文档' }, { size: 100, overlap: 20 }).length, 1, '比 size 还短的文档只切 1 块')

        const index = buildIndex(NOVA_DOCS)
        const cases: [string, string][] = [
          ['门锁指纹最多能录几个', 'l2-manual'],
          ['退货运费谁承担', 'faq-returns'],
          ['空调滤网多久清洗一次', 'x1-manual'],
          ['App 显示设备离线怎么办', 'faq-offline'],
        ]
        for (const [q, want] of cases) {
          const hits = index.search(q, 3)
          ctx.assert(hits.length <= 3, 'search(query, k) 最多返回 k 条')
          ctx.assert(
            hits.some((h) => h.chunk.docId === want),
            `检索“${q}”时，前 3 条结果里应该有 ${want}，实际：${hits.map((h) => h.chunk.id).join(', ') || '（空）'}。中文要用字二元组分词，BM25 要考虑 IDF`,
          )
          ctx.assert(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score), '结果要按 score 降序排列')
        }
      },
    },
    {
      id: 'cited-answer',
      title: '带出处的回答',
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.cited.q, buildIndex(NOVA_DOCS))
        ctx.includes(r.answer, 'Type-C', '回答应基于检索到的手册内容——检索结果要放进 prompt')
        ctx.assert(r.citations.length > 0, 'citations 为空。prompt 里要给每个块标上 [文档id#块编号]，并要求模型按这个格式标注出处')
        ctx.assert(r.citations.every((c) => c.startsWith('l2-manual#')), `出处应指向 L2 手册，实际：${r.citations.join(', ')}`)

        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 1, '一个问题只需要调用 1 次模型')
        const req = calls[0].request
        const all = NOVA_DOCS.reduce((n, d) => n + estimateTokens(d.text), 0)
        const used = requestTokens(req)
        ctx.assert(used < all * 0.5, `这次请求用了 ${used} tokens，而整个知识库才 ${all} tokens。只把检索到的前 k 块放进 prompt，不要把所有文档都塞进去`)
        ctx.assert(!visibleText(req).includes('不会向第三方出售'), '无关文档（隐私政策）也被发给了模型——只发送检索到的块')
      },
    },
    {
      id: 'fake-citation',
      title: '过滤编造的出处',
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.fake.q, buildIndex(NOVA_DOCS))
        ctx.includes(r.answer, '2 年', '应正常回答保修期')
        ctx.assert(!r.citations.includes('faq-warranty#9'), '模型编造了出处 faq-warranty#9（根本不存在）。要用检索到的块 id 校验 citations，不在其中的一律丢掉')
        ctx.assert(!r.answer.includes('faq-warranty#9'), '回答正文里也要删掉编造的出处标记，别让用户点到一个不存在的链接')
        ctx.assert(r.citations.some((c) => c.startsWith('faq-warranty#')), `真实的出处要保留，实际：${r.citations.join(', ') || '（空）'}`)
      },
    },
    {
      id: 'not-in-docs',
      title: '资料里没有：不编造',
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.missing.q, buildIndex(NOVA_DOCS))
        ctx.assert(!/HomeKit|Siri/.test(r.answer), `模型编造了答案：“${r.answer}”。prompt 里要明确要求：资料里没有答案时就说没有，不要编造`)
        ctx.includes(r.answer, /没有|无法|不清楚|找不到/, '应该如实告诉用户资料里没有相关信息')
        ctx.eq(r.citations, [], '拒答时不应附带出处')
      },
    },
    {
      id: 'out-of-scope',
      title: '无关问题：不调用模型',
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(OUT_OF_SCOPE, buildIndex(NOVA_DOCS))
        ctx.eq(ctx.trace.llmCalls().length, 0, '检索的最高分低于阈值时，说明知识库里没有相关资料，应该直接拒答，不要再花钱调用模型')
        ctx.assert(r.answer.length > 0, '拒答也要给用户一句说明')
        ctx.eq(r.citations, [], '拒答时 citations 为空')
      },
    },
  ],
}
