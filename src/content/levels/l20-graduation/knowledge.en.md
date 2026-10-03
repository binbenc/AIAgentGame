## Production notes

- **The assembly order is the order of your defenses**: routing (save money) → a least-privilege toolset → marking untrusted data → deterministic policies and approvals → a loop with retries, timeouts and a step limit → budgets → output filtering → tracing. Leave out any layer and someday it becomes an incident.
- **Agentic RAG**: making retrieval a tool, so the model decides when and what to search, is cheaper and more flexible than retrieving before every message. The price is that you need evals to confirm it actually searches when it should.
- **Human approval** can be a synchronous callback (e.g. a dialog asking the user to confirm) or a pause-and-resume flow like Level 12 (for cases that need a supervisor and may wait hours).
- **A fallback matters more than perfection**: production will send you inputs you never imagined. Make sure the worst case is "hand off to a human gracefully", not an error, an infinite loop, or runaway spend.
- **Launch process**: regression with `npm test` in the exported project → run evals against a real model (`npm run test:real`) → canary at 5% of traffic → watch cost, latency, handoff rate and negative-feedback rate → ramp up gradually.
- What to add next: multi-turn sessions (Level 7's context compaction), streaming output (Level 13), exposing your tools to other teams over MCP (Level 19), and an evaluator-optimizer for higher-quality replies (Level 15).
- Head to the graduation page and export your project. `examples/` has side-by-side ports to the Claude Agent SDK, OpenAI Agents SDK and LangGraph.
