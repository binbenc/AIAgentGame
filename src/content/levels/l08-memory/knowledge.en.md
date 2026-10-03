## Production notes

- Memory comes in layers: **working memory** (the current messages) → **session summary** (last level) → **long-term memory** (user profile, preferences and facts across sessions). Only the last one needs to be persisted.
- There are two ways to write memories: ① the model saves them **actively** through a `save_memory` tool (this level; Anthropic's memory tool and ChatGPT's memory work this way); ② an **offline** extraction job runs after the session and distills facts from the transcript. The latter adds no latency to the conversation and scales well.
- When to read: at session start, **recall a few relevant memories** for the current question and inject them into the system prompt, rather than stuffing in everything. Memories pile up, and dumping them all is expensive and distracts the model. Also provide a `search_memory` tool so the model can look things up on demand.
- This level scores by keyword overlap. In production you'd usually use **vector search** (embeddings) or hybrid keyword + vector retrieval; it's the same retrieval machinery as next level's RAG.
- **Privacy and compliance**: filter sensitive data (PII, passwords, payment details) before writing; isolate per user at the storage layer (always key by userId, never rely on the prompt alone); let users view and delete their memories (the "right to erasure" in GDPR and China's PIPL).
- Memories go stale and conflict ("I moved"). Timestamp them, let newer facts override older ones, and when needed have the model merge or delete outdated memories.
- Memory content comes from user input, so it's **untrusted data**: wrap it in clear delimiter tags when injecting it into the prompt, so nobody can store "ignore previous instructions" in memory (prompt injection, level 17).
