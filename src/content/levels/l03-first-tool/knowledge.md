## 生产落地要点

- **assistant 消息要原样回传完整的 `content`**，不能只回传文本。里面的 `tool_use` 块（以及 thinking 块）是协议要求的，缺了会直接 400。
- `tool_use_id` 是配对的钥匙：每个 `tool_use` 都必须在下一条 user 消息里有对应的 `tool_result`。
- 工具描述的写法：**做什么 + 什么时候用 + 什么时候不要用 + 返回什么**。参数也要写 description，并给出格式示例。
- 工具的返回值要**精简**：只给模型做决策需要的字段，这样省 token，也能减少干扰。
- OpenAI 协议里，工具结果是单独的 `role: "tool"` 消息，参数是**字符串形式的 JSON**（`arguments`）。到 Trace 的「原始报文」里对比一下。
- 打开 Anthropic 的 `strict: true`（或 OpenAI 的 `strict` function），可以保证参数严格符合 schema。
