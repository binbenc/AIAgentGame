## 任务

新建 `rag.ts`（知识库 `NOVA_DOCS` 由判题环境传入，每篇是 `{ id, title, text }`）：

```ts
chunk(doc, { size, overlap }) → Chunk[]            // Chunk = { id: 'l2-manual#1', docId, index, text }
class BM25Index { constructor(chunks); search(query, k = 3) → { chunk, score }[] }
buildIndex(docs, opts = { size: 150, overlap: 30 }) → BM25Index
answerWithCitations(question, index, { k?, minScore? }) → Promise<{ answer, citations }>
```

1. **切块**：定长滑动窗口，步长 `size - overlap`；最后一块要覆盖到文档末尾；块 id 为 `文档id#块编号`（从 0 开始）。
2. **BM25 检索**：分词复用 `memory.ts` 的 `tokenize`（中文字二元组）。得分为 0 的块不返回；按得分降序取前 `k` 条。
3. **拒答阈值**：最高分低于 `minScore` 时（或者没有结果），**不调用模型**，直接返回一句拒答说明和空的 `citations`。阈值要自己用几个问题试出来。
4. **生成**：只把检索到的前 `k` 块放进 prompt，每块前面标上 `[块id]`。system 里要求：只根据资料回答；每个结论后用 `[文档id#块编号]` 标注出处；资料里没有答案时就说没有，不要编造。
5. **校验出处**：从回答里解析出所有 `[xxx#n]`，**只保留本次真正检索到的块 id**，编造的出处要从 `citations` 和回答正文里一起删掉。

## 判题场景
- 切块与检索（单元测试）
- 带出处的回答：出处正确，并且只把检索到的块发给模型
- 过滤编造的出处
- 资料里没有：不编造
- 无关问题：不调用模型
