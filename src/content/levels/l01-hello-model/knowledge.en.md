## Production notes

- **The message protocol is the real thing.** Anthropic or OpenAI, it's always `messages[] → content blocks`. In the Trace panel on the right, compare the "Anthropic wire format" and "OpenAI wire format" tabs: Anthropic has `system` as a top-level field, while OpenAI sends it as a `role: "system"` message.
- **Never assume `content[0]` is text.** Reasoning models return a thinking block first; tool calls and citations produce other block types too. Filter by `type`.
- **Always check `stop_reason`.** `max_tokens` means the output was cut off. Using truncated JSON or a truncated answer as if it were complete leads to very confusing production bugs. Another common stop reason is `refusal` (the model declined to answer).
- **Cost = input_tokens × price + output_tokens × price.** Record `usage` from day one; you'll need it for cost analysis later.
- **Sampling parameters**: newer Claude models no longer accept `temperature` / `top_p` and use parameters like `effort` to control reasoning depth instead; most OpenAI-compatible APIs still support `temperature`. Don't treat sampling parameters as a quality lifeline: **the prompt and the context are the main levers**.
- Don't set `max_tokens` too low. It's a hard cap on output that the model itself doesn't know about; when it's hit, the output simply stops.
