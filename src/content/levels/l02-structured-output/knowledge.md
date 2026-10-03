## 生产落地要点

- **能用原生结构化输出就用原生的**。Anthropic 提供 `output_config.format`（JSON Schema 约束解码）和 `strict: true` 的工具调用；OpenAI 提供 `response_format: json_schema`。约束解码能从根上保证格式合法，但**业务层面的校验（比如订单号格式）仍然要你自己做**。
- 本关的“解析 → 校验 → 带着错误重试”模式适用于任何模型，也是兜底方案。
- 反馈给模型的错误要**具体**：写清楚“priority 必须是 low/medium/high 之一，你给的是 urgent”，这比一句“格式不对”有效得多。
- 重试必须设上限，并且要打日志、报指标。重试率突然升高，往往说明模型版本变了或者 prompt 退化了。
- schema 用 zod / pydantic 定义，**一份定义同时生成类型、校验器和 JSON Schema**，避免三处定义不一致。
- 枚举值越少越好，并且给出“兜底类别”（这里是 `other`），否则模型会自己编造新类别。
