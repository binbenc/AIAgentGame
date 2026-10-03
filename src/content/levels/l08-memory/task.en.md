## Task

Create `memory.ts`:

```ts
tokenize(text) → string[]                      // English by word, Chinese by character bigram
containsSecret(text) → string | null           // returns the reason to refuse
class MemoryStore {
  remember(userId, fact): MemoryItem           // throws on secrets; dedupes identical facts
  recall(userId, query, k = 3): MemoryItem[]   // this user only; ranked by overlap; zero scores dropped
  all(userId): MemoryItem[]
}
createMemoryTools(store, userId) → Tool[]      // save_memory, search_memory
buildSystemWithMemories(base, memories) → string
chatWithMemory(store, userId, message, opts?) → Promise<AgentResult>
```

1. **Tokenizing and recall**: English words and numbers are tokens; Chinese has no spaces, so it's split into character bigrams ("上门安装" → 上门 / 门安 / 安装). `recall` scores each memory by how many query tokens it contains (optionally normalized by the memory's length), drops zero scores and returns the top `k`.
2. **User isolation**: `recall` and the tools only read and write the current `userId`'s memories.
3. **Secrets**: `remember` throws on anything that looks like a card or ID number (13–19 digits, possibly with spaces or dashes), a password or a verification code. `agent.ts` turns exceptions inside tools into `is_error` results, so the model learns nothing was saved.
4. **Memory tools**: `save_memory` (required parameter: the fact to remember) and `search_memory` (required parameter: the query). The descriptions should say clearly what to save and what must never be saved.
5. **Inject at session start**: `chatWithMemory` first calls `recall(userId, message)`, merges the results into the system prompt with `buildSystemWithMemories` (unchanged when there are none), then calls `runAgent` with the memory tools added to the tool list.

## Scenarios
- Memory store (unit test): recall ranking, dedupe, user isolation, empty result for unrelated queries
- Remember preferences across sessions: the first session saves "visits only after 8 pm", the second, brand-new session books around it
- No secrets in memory: asked to remember a credit card number, the agent must refuse, and the model must learn it was refused
