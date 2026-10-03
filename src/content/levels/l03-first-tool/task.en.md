## Task

In `tools.ts`:

1. Implement `makeWeatherTool(getWeather)`, which returns a `Tool`:
   - `spec`: `name` in snake_case (e.g. `get_weather`); `description` says clearly **what it does and when to use it**; `input_schema` has one required string parameter `city`, with its own `description`.
   - `run(input)`: calls `getWeather(input.city)` and returns the result.
2. Implement `answerOnce(question, tool)`, doing **one full tool round trip**:
   - 1st `chat`: pass `tools: [tool.spec]`
   - If `stop_reason === 'tool_use'`: run **every** `tool_use` block, then make the 2nd `chat` call with these messages in order:
     `user(question)` → `assistant(the full content of the 1st response)` → `user([tool_result...])`
   - `tool_result.content` must be a string; `JSON.stringify` objects first
   - Return the text of the final answer; if the model doesn't need the tool, return the text of the 1st response directly

## Test scenarios
- Tool definition conventions
- Weather lookup: the temperature in the answer must come from the tool result
- Small talk: don't force a tool call when none is needed
