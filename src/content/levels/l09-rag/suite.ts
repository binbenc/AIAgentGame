import type { LevelSuite, ScenarioCtx } from '../../../engine/judge/types'
import { say, visibleText } from '../../../engine/llm/mock-kit'
import { estimateTokens, requestTokens } from '../../../engine/llm/tokens'
import { L } from '../../../engine/locale'
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

const QAS_ZH: Record<string, QA> = {
  cited: { q: '智能门锁 L2 没电了怎么开门？', needle: 'Type-C 应急供电', answer: '可以用充电宝连接锁体底部的 Type-C 应急供电口临时供电，再用指纹或密码开门。' },
  fake: { q: '扫地机器人 R5 的保修期是多久？', needle: 'R5 整机保修 2 年', answer: 'R5 整机保修 2 年，电池保修 1 年。', fake: 'faq-warranty#9' },
  missing: { q: '智能空调 X1 能接入苹果 HomeKit 吗？', hallucination: '可以的，X1 支持直接接入苹果 HomeKit，用 Siri 就能控制。' },
}
const QAS_EN: Record<string, QA> = {
  cited: {
    q: 'My Smart Lock L2 ran out of battery. How do I open the door?',
    needle: 'Type-C emergency port',
    answer: 'Plug a power bank into the Type-C emergency port at the bottom of the lock for temporary power, then open the door with a fingerprint or passcode.',
  },
  fake: {
    q: 'How long is the warranty on the Robot Vacuum R5?',
    needle: 'Robot Vacuum R5: 2 years on the whole unit',
    answer: 'The R5 has 2 years of warranty on the whole unit and 1 year on the battery.',
    fake: 'faq-warranty#9',
  },
  missing: { q: 'Does the Smart AC X1 work with Apple HomeKit?', hallucination: 'Yes, the X1 works with Apple HomeKit out of the box, so you can control it with Siri.' },
}
const QAS = L(QAS_ZH, QAS_EN)
const OUT_OF_SCOPE = L('帮我写一首关于秋天的诗', 'Write a poem about autumn')

const CITE_ID = /[a-z0-9]+(?:-[a-z0-9]+)*#\d+/g

export const suite: LevelSuite = {
  budgets: L({ calls: 3, tokens: 1830 }, { calls: 3, tokens: 1300 }),
  mock(req) {
    const text = visibleText(req)
    const qa = Object.values(QAS).find((x) => text.includes(x.q))
    if (!qa) return say(L('您好，请问有什么可以帮您？', 'Hi, how can I help you?'))
    const ids = [...text.matchAll(CITE_ID)]
    const wantsCite = ids.length > 0 && /引用|标注|出处|来源|cite|citation|source/i.test(text)
    const mayRefuse =
      /不知道|没有相关|无法回答|不要编造|不确定|找不到|没有答案/.test(text) ||
      /don'?t know|do not know|no relevant|don'?t make|do not make|make (?:anything|things|it|up)|making (?:anything |things )?up|don'?t invent|do not invent|fabricat|not sure|can'?t find|cannot find|couldn'?t find|no answer|don'?t (?:have|contain) (?:the|an|that|this)|doesn'?t (?:have|contain) (?:the|an)/i.test(text)

    const at = qa.needle ? text.indexOf(qa.needle) : -1
    if (at >= 0) {
      // 出处 = 答案片段前面最近的那个块 id
      const id = ids.filter((m) => m.index! < at).at(-1)?.[0]
      let out = qa.answer!
      if (wantsCite && id) out += ` [${id}]`
      if (wantsCite && qa.fake) out += ` [${qa.fake}]`
      return say(out)
    }
    if (mayRefuse) return say(L('抱歉，资料中没有相关信息，建议联系人工客服确认。', "Sorry, the docs don't have that information. Please check with a human agent."))
    // 没有资料、也没被要求“不知道就说不知道”：模型会一本正经地编
    return say((qa.hallucination ?? L('应该是可以的。', 'It should work.')) + (wantsCite && ids[0] ? ` [${ids[0][0]}]` : ''))
  },
  scenarios: [
    {
      id: 'retrieval-unit',
      title: L('切块与检索（单元测试）', 'Chunking and retrieval (unit test)'),
      async run(ctx: ScenarioCtx) {
        const { chunk, buildIndex } = ctx.load<Mod>('rag.ts')
        const text = Array.from({ length: 25 }, (_, i) => L(`第${String(i).padStart(2, '0')}段的示例内容。`, `Para ${String(i).padStart(2, '0')}. `)).join('')
        const cs = chunk({ id: 'demo', title: L('演示', 'Demo'), text }, { size: 100, overlap: 20 })
        ctx.eq(cs.map((c) => c.id), ['demo#0', 'demo#1', 'demo#2'], L(`${text.length} 字、size=100、overlap=20：应切成 3 块，id 形如 "文档id#块编号"`, `${text.length} chars, size=100, overlap=20: expect 3 chunks with ids like "docId#chunkNumber"`))
        ctx.eq(cs[1].text, text.slice(80, 180), L('第 2 块应从第 80 个字符开始（步长 = size - overlap），和上一块重叠 20 个字符', 'Chunk 2 should start at character 80 (step = size - overlap), overlapping the previous chunk by 20 characters'))
        ctx.assert(cs.every((c) => c.text.length <= 100 && c.docId === 'demo'), L('每块不超过 size，并记录 docId', 'Each chunk is at most size long and records its docId'))
        ctx.assert(cs[cs.length - 1].text.endsWith(text.slice(-10)), L('最后一块要覆盖到文档末尾', 'The last chunk must reach the end of the doc'))
        ctx.eq(
          chunk({ id: 's', title: L('短', 'Short'), text: L('很短的文档', 'A tiny doc') }, { size: 100, overlap: 20 }).length,
          1,
          L('比 size 还短的文档只切 1 块', 'A doc shorter than size is a single chunk'),
        )

        const index = buildIndex(NOVA_DOCS)
        const cases: [string, string][] = L(
          [
            ['门锁指纹最多能录几个', 'l2-manual'],
            ['退货运费谁承担', 'faq-returns'],
            ['空调滤网多久清洗一次', 'x1-manual'],
            ['App 显示设备离线怎么办', 'faq-offline'],
          ],
          [
            ['How many fingerprints can the lock store', 'l2-manual'],
            ['Who pays return shipping', 'faq-returns'],
            ['How often should I clean the AC filter', 'x1-manual'],
            ['The app shows my device offline, what do I do', 'faq-offline'],
          ],
        )
        for (const [q, want] of cases) {
          const hits = index.search(q, 3)
          ctx.assert(hits.length <= 3, L('search(query, k) 最多返回 k 条', 'search(query, k) returns at most k hits'))
          ctx.assert(
            hits.some((h) => h.chunk.docId === want),
            L(
              `检索“${q}”时，前 3 条结果里应该有 ${want}，实际：${hits.map((h) => h.chunk.id).join(', ') || '（空）'}。中文要用字二元组分词，BM25 要考虑 IDF`,
              `Searching "${q}" should put ${want} in the top 3; got: ${hits.map((h) => h.chunk.id).join(', ') || '(none)'}. Tokenize with tokenize() and make BM25 account for IDF`,
            ),
          )
          ctx.assert(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score), L('结果要按 score 降序排列', 'Results must be sorted by score, descending'))
        }
      },
    },
    {
      id: 'cited-answer',
      title: L('带出处的回答', 'Answer with citations'),
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.cited.q, buildIndex(NOVA_DOCS))
        ctx.includes(r.answer, 'Type-C', L('回答应基于检索到的手册内容——检索结果要放进 prompt', 'The answer should come from the retrieved manual: put the retrieved chunks into the prompt'))
        ctx.assert(r.citations.length > 0, L('citations 为空。prompt 里要给每个块标上 [文档id#块编号]，并要求模型按这个格式标注出处', 'citations is empty. Label every chunk in the prompt with [docId#chunkNumber] and ask the model to cite in that format'))
        ctx.assert(r.citations.every((c) => c.startsWith('l2-manual#')), L(`出处应指向 L2 手册，实际：${r.citations.join(', ')}`, `Citations should point to the L2 manual; got: ${r.citations.join(', ')}`))

        const calls = ctx.trace.llmCalls()
        ctx.eq(calls.length, 1, L('一个问题只需要调用 1 次模型', 'One question needs exactly 1 model call'))
        const req = calls[0].request
        const all = NOVA_DOCS.reduce((n, d) => n + estimateTokens(d.text), 0)
        const used = requestTokens(req)
        ctx.assert(used < all * 0.5, L(
            `这次请求用了 ${used} tokens，而整个知识库才 ${all} tokens。只把检索到的前 k 块放进 prompt，不要把所有文档都塞进去`,
            `This request used ${used} tokens, while the whole knowledge base is only ${all}. Put only the top k retrieved chunks in the prompt, not every doc`,
          ))
        ctx.assert(
          !visibleText(req).includes(L('不会向第三方出售', 'never sells user data')),
          L('无关文档（隐私政策）也被发给了模型——只发送检索到的块', 'An unrelated doc (the privacy policy) was sent to the model too: send only the retrieved chunks'),
        )
      },
    },
    {
      id: 'fake-citation',
      title: L('过滤编造的出处', 'Filter made-up citations'),
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.fake.q, buildIndex(NOVA_DOCS))
        ctx.includes(r.answer, L('2 年', '2 years'), L('应正常回答保修期', 'It should still answer the warranty question'))
        ctx.assert(!r.citations.includes('faq-warranty#9'), L('模型编造了出处 faq-warranty#9（根本不存在）。要用检索到的块 id 校验 citations，不在其中的一律丢掉', "The model made up the citation faq-warranty#9 (it doesn't exist). Check citations against the retrieved chunk ids and drop anything else"))
        ctx.assert(!r.answer.includes('faq-warranty#9'), L('回答正文里也要删掉编造的出处标记，别让用户点到一个不存在的链接', "Remove the made-up citation from the answer text too, so users don't click a link to nowhere"))
        ctx.assert(r.citations.some((c) => c.startsWith('faq-warranty#')), L(`真实的出处要保留，实际：${r.citations.join(', ') || '（空）'}`, `Keep the real citations; got: ${r.citations.join(', ') || '(none)'}`))
      },
    },
    {
      id: 'not-in-docs',
      title: L('资料里没有：不编造', "Not in the docs: don't make it up"),
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(QAS.missing.q, buildIndex(NOVA_DOCS))
        ctx.assert(!/HomeKit|Siri/.test(r.answer), L(`模型编造了答案：“${r.answer}”。prompt 里要明确要求：资料里没有答案时就说没有，不要编造`, `The model made up an answer: "${r.answer}". The prompt must say explicitly: if the docs don't have the answer, say so; don't make anything up`))
        ctx.includes(
          r.answer,
          L(/没有|无法|不清楚|找不到/, /don'?t|doesn'?t|couldn'?t|can'?t|no information|not sure/i),
          L('应该如实告诉用户资料里没有相关信息', "Tell the user honestly that the docs don't cover it"),
        )
        ctx.eq(r.citations, [], L('拒答时不应附带出处', 'A refusal should carry no citations'))
      },
    },
    {
      id: 'out-of-scope',
      title: L('无关问题：不调用模型', 'Off-topic question: no model call'),
      async run(ctx: ScenarioCtx) {
        const { buildIndex, answerWithCitations } = ctx.load<Mod>('rag.ts')
        const r = await answerWithCitations(OUT_OF_SCOPE, buildIndex(NOVA_DOCS))
        ctx.eq(ctx.trace.llmCalls().length, 0, L('检索的最高分低于阈值时，说明知识库里没有相关资料，应该直接拒答，不要再花钱调用模型', "When the top retrieval score is below the threshold, the knowledge base has nothing relevant: refuse right away instead of paying for a model call"))
        ctx.assert(r.answer.length > 0, L('拒答也要给用户一句说明', 'A refusal still owes the user a sentence of explanation'))
        ctx.eq(r.citations, [], L('拒答时 citations 为空', 'A refusal has empty citations'))
      },
    },
  ],
}
