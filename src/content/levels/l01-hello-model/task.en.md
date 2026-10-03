## Task

Implement in `llm.ts`:

```ts
ask(question: string, opts?: { system?: string; maxTokens?: number }): Promise<AskResult>
```

It returns `{ text, usage, truncated }`:

1. Use `chat()` to send the question as a single `user` message; pass `system` / `maxTokens` along when given (the field names are `system` and `max_tokens`).
2. `text`: join **all** blocks with `type === 'text'` in the response. The response may contain other blocks too (e.g. the model's thinking block), and the text may be split across several blocks.
3. `usage`: return the response's `usage` as is.
4. `truncated`: `true` when `stop_reason === 'max_tokens'`, meaning the answer was cut off.

Finally, write a system prompt in `NOVA_SYSTEM` so the model answers as **Nova Tech's support assistant** (it must mention "Nova").

## Test scenarios
- Basic Q&A: correct answer, usage is filled in
- Persona: the answer to `askNova('Who are you?')` must introduce itself as Nova
- Multiple content blocks: don't just take `content[0]`
- Truncation: with a tiny `maxTokens`, detect that the answer was cut off
