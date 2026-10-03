## Task

Create `rag.ts` (the knowledge base `NOVA_DOCS` is passed in by the grader; each doc is `{ id, title, text }`):

```ts
chunk(doc, { size, overlap }) → Chunk[]            // Chunk = { id: 'l2-manual#1', docId, index, text }
class BM25Index { constructor(chunks); search(query, k = 3) → { chunk, score }[] }
buildIndex(docs, opts = { size: 300, overlap: 100 }) → BM25Index
answerWithCitations(question, index, { k?, minScore? }) → Promise<{ answer, citations }>
```

1. **Chunking**: a fixed-size sliding window with step `size - overlap`; the last chunk must reach the end of the doc; chunk ids are `docId#chunkNumber` (starting at 0).
2. **BM25 retrieval**: reuse `tokenize` from `memory.ts`. Don't return chunks that score 0; return the top `k` by score, descending.
3. **Refusal threshold**: if the top score is below `minScore` (or there are no hits), **don't call the model**; return a short refusal and empty `citations`. Find a good threshold by trying a few questions yourself.
4. **Generation**: put only the top `k` retrieved chunks in the prompt, each labeled `[chunkId]`. The system prompt says: answer only from the docs; cite each claim as `[docId#chunkNumber]`; if the docs don't have the answer, say so and don't make anything up.
5. **Check citations**: parse every `[xxx#n]` from the answer and **keep only chunk ids that were actually retrieved this time**. Remove made-up citations from both `citations` and the answer text.

## Scenarios
- Chunking and retrieval (unit test)
- Answer with citations: correct sources, and only retrieved chunks are sent to the model
- Filter made-up citations
- Not in the docs: don't make it up
- Off-topic question: no model call
