## 任务

在 `llm.ts` 中实现：

```ts
ask(question: string, opts?: { system?: string; maxTokens?: number }): Promise<AskResult>
```

返回 `{ text, usage, truncated }`：

1. 用 `chat()` 把问题作为一条 `user` 消息发出去；有 `system` / `maxTokens` 时一并传入（字段名是 `system`、`max_tokens`）。
2. `text`：把响应里**所有** `type === 'text'` 的块拼接起来。响应里可能还有别的块（例如模型的 thinking 块），而且文本可能被拆成多个块。
3. `usage`：原样返回响应里的 `usage`。
4. `truncated`：当 `stop_reason === 'max_tokens'` 时为 `true`，说明回答被截断了。

最后给 `NOVA_SYSTEM` 写一个 system prompt，让模型以 **Nova 科技客服助手**的身份回答（内容里要出现 “Nova”）。

## 判题场景
- 基础问答：答案正确，usage 有值
- 人设：`askNova('你是谁？')` 的回答里要自报 Nova 家门
- 多内容块：不能只取 `content[0]`
- 截断检测：`maxTokens` 很小的时候要能发现回答被截断
