## Production notes

- **RAG = retrieval + generation**. It solves two problems: "the model doesn't know your private knowledge" and "knowledge changes". Confirm the problem really is missing knowledge before reaching for RAG, and reach for RAG before fine-tuning.
- **Chunking** sets the ceiling for retrieval: chunks too big are noisy and waste tokens; too small and answers get shredded. A common approach is to split on headings / paragraphs / sentences (semantic chunking) with 10%–20% overlap, and attach metadata like the doc title to each chunk.
- **Hybrid retrieval**: BM25 (keywords) is great for exact terms like model numbers, order ids and error codes; vector search (embeddings) handles paraphrases. In production you usually run both, merge with RRF, and rerank the top few dozen with a **reranker**.
- **Citations are first-class**: give each chunk a stable id, ask the model to cite claim by claim, and before returning, verify every citation came from this retrieval. Anthropic's Citations feature and OpenAI's file search both return structured citations directly.
- **Allow "I don't know"**: tell the model explicitly to refuse when the docs fall short, and add a retrieval score threshold; below it, go straight to a canned reply and save the model call. Calibrate the threshold on a real question set (evals, level 16).
- Retrieved documents are **untrusted input**: a doc may hide "ignore the instructions above" (indirect prompt injection, level 17). Fence the docs off from the instructions with tags, and tell the model never to follow instructions found inside them.
- Evaluate RAG in two halves: **retrieval** by hit rate / Recall@k, **generation** by faithfulness (is every claim supported by the docs?) and citation accuracy.
