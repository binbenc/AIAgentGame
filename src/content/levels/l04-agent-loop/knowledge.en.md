## Production notes

- This loop is the core of Anthropic's Tool Runner, the OpenAI Agents SDK and LangGraph's `create_react_agent`. Understand it, and every framework is just features on top.
- **A step limit is mandatory**, ideally alongside token and cost limits (Level 18). When a limit is hit, give the user a graceful fallback reply and raise an alert.
- Parallel tool calls: when the model returns several `tool_use` blocks at once, **run them all** and put every `tool_result` into **one** user message. Splitting them across messages teaches the model to use parallel calls less and less.
- `messages` is the agent's entire state. Persist it and you get resumable runs, auditing and replay (Level 12).
- Ask yourself first: **does this task really need an agent?** For a fixed process, a hard-coded workflow is cheaper and easier to control (Level 11).
