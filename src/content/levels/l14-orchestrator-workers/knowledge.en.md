## Production notes

- The biggest win of multi-agent systems is **context isolation**, not "role-play". Each sub-agent processes lots of raw data in a clean context and hands back only a compressed conclusion, so the orchestrator's context stays small and clean. Anthropic's multi-agent research system and Claude Code's subagents both work this way.
- **Write subtasks clearly**: goal, scope, output format, available tools, when to stop. With vague descriptions, workers duplicate each other's work or leave gaps.
- **Least-privilege toolsets**: a worker gets only the tools it needs. That means fewer chances to pick the wrong tool and a smaller blast radius when something goes wrong.
- Parallelism buys you **latency**, not cost: total tokens are usually higher than with a single agent (multi-agent systems commonly use 3–15x). Use it only when the task splits into independent, high-value subtasks; for strictly sequential tasks, use a workflow (Level 11).
- **Make partial failure explicit**: workers handle their own exceptions, the result is flagged `partial`, and the final answer tells the user what's missing. That's far better than failing the whole report or quietly making something up.
- Cap the number of subtasks the orchestrator can create, and each worker's steps and tokens, to avoid runaway plans like "50 subtasks".
- Observability: tag each worker with its subtask id so you can see each worker's latency and tokens in the trace.
