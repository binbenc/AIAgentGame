## Task

Create `session.ts`, a multi-turn session that compacts its own history:

```ts
class ChatSession {
  constructor(opts: { system?: string; maxContextTokens: number; keepLastTurns?: number; tools?: Tool[] })
  messages: Message[]
  send(userText: string): Promise<string>
}
splitForCompaction(messages, keepLastTurns) → { older, recent }
```

1. **`splitForCompaction` (pure function)**: split by turn. A turn starts with a **user message** (`role === 'user'` and not a `tool_result` message) and includes the assistant replies, tool calls and tool results that follow. The last `keepLastTurns` turns go into `recent`, everything earlier into `older`; with too few turns, `older` is empty. Only cut on turn boundaries; `older + recent` must be exactly the original array.
2. **`summarize(older)`**: a separate `chat()` call that writes the summary. The system prompt must say it's a **summarization** task and ask it to keep key facts like names, order numbers and time preferences; the user message holds `renderTranscript(older)` (provided).
3. **`send(userText)`**:
   - push the user message onto `messages`;
   - measure the next request with `countTokens({ system, messages, tools })` (**tools count too**);
   - over `maxContextTokens`, compact: `messages = [{ role: 'user', content: '[Conversation summary] ' + summary }, ...recent]`. If it's still over, keep one turn fewer and compact again;
   - then call `runAgent(this.messages, tools, { system })` (from `agent.ts`), replace the history with the returned `messages`, and return `output`.
4. **Don't** summarize while under budget: every summary is an extra model call.

## Scenarios
- Split by turn (unit test): a history with tool round trips must never leave an orphaned `tool_result`
- Short chats are not compacted: 3 turns, exactly 3 model calls
- Long chat: 26 turns with a shipping lookup in the middle; every request stays within budget, the final answer still has the name, order number and delivery time from turn 1, and total tokens are well below the no-compaction approach
