## Production notes

- **Use native structured outputs when you can.** Anthropic offers `output_config.format` (JSON Schema constrained decoding) and `strict: true` tool calls; OpenAI offers `response_format: json_schema`. Constrained decoding guarantees valid syntax at the source, but **business validation (like the order id format) is still on you**.
- This level's "parse → validate → retry with the error" pattern works with any model and is your fallback.
- Make the error you feed back **specific**: "priority must be one of low/medium/high, you gave urgent" works far better than "wrong format".
- Retries must be capped, logged and tracked as a metric. A sudden jump in the retry rate usually means the model version changed or the prompt regressed.
- Define schemas with zod / pydantic so **one definition gives you the type, the validator and the JSON Schema**, and the three never drift apart.
- Keep enums small and include a catch-all category (here `other`); otherwise the model will invent new categories.
