## 任务

在 `tools.ts` 中：

1. 实现 `makeWeatherTool(getWeather)`，返回一个 `Tool`：
   - `spec`：`name` 用 snake_case（例如 `get_weather`）；`description` 写清楚**做什么、什么时候用**；`input_schema` 里有一个必填的字符串参数 `city`，并且带 `description`。
   - `run(input)`：调用 `getWeather(input.city)` 并返回结果。
2. 实现 `answerOnce(question, tool)`，完成**一次完整的工具往返**：
   - 第 1 次 `chat`：带上 `tools: [tool.spec]`
   - 如果 `stop_reason === 'tool_use'`：执行**每一个** `tool_use` 块，然后发起第 2 次 `chat`，消息依次为：
     `user(问题)` → `assistant(第 1 次响应的完整 content)` → `user([tool_result...])`
   - `tool_result.content` 必须是字符串，对象要先 `JSON.stringify`
   - 返回最终回答的文本；如果模型不需要工具，就直接返回第 1 次的文本

## 判题场景
- 工具定义规范
- 查询天气：回答里的温度必须来自工具返回的结果
- 闲聊：不需要工具时不能硬调用
