## 生产落地要点

- **消息协议才是本体**。不论 Anthropic 还是 OpenAI，本质上都是 `messages[] → content blocks`。打开右侧 Trace 的「原始报文」，对比两家协议的差别：Anthropic 的 `system` 是顶层字段；OpenAI 则把它放成一条 `role: "system"` 的消息。
- **永远不要假设 `content[0]` 就是文本**。开启推理的模型会先返回 thinking 块；工具调用、引用也都会产生其它类型的块。按 `type` 过滤。
- **一定要检查 `stop_reason`**。`max_tokens` 表示输出被截断了，如果拿截断的 JSON 或截断的回答直接用，会出现很诡异的线上 bug。还有一个常见的停止原因是 `refusal`（模型拒答）。
- **成本 = input_tokens × 单价 + output_tokens × 单价**。从第一天起就把 `usage` 记下来，后面做成本分析时用得上。
- **采样参数**：较新的 Claude 模型不再接受 `temperature` / `top_p`，改用 `effort` 之类的参数控制推理深度；OpenAI 兼容接口大多还支持 `temperature`。不要把采样参数当成质量的救命稻草，**prompt 和上下文才是主要杠杆**。
- `max_tokens` 别设得太小。它是输出的硬上限，模型自己并不知道这个值，到了就直接被截断。
