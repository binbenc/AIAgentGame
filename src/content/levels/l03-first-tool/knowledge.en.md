## Production notes

- **Send the assistant message back with its full `content`**, not just the text. The `tool_use` blocks in it (and thinking blocks) are required by the protocol; leave them out and you get a 400.
- `tool_use_id` is the pairing key: every `tool_use` must have a matching `tool_result` in the next user message.
- How to write a tool description: **what it does + when to use it + when not to use it + what it returns**. Describe parameters too, with a format example.
- Keep tool results **lean**: only the fields the model needs to decide. That saves tokens and reduces distraction.
- In the OpenAI protocol, a tool result is a separate `role: "tool"` message, and the arguments are **JSON in a string** (`arguments`). Compare the two in the Trace panel's wire format tabs.
- Turn on Anthropic's `strict: true` (or OpenAI's `strict` functions) to guarantee arguments strictly match the schema.
