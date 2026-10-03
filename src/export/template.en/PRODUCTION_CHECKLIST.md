# Production launch checklist

> Every item maps to something you built yourself in Agent Quest. Check them one by one before launch; the level is in parentheses.

## Model calls
- [ ] `stop_reason` is checked: `max_tokens` (truncation) and `refusal` are both handled (L1)
- [ ] Structured output: validated against a schema, retried with the error on failure, with a retry cap; use native structured outputs when available (L2)
- [ ] Thinking / opaque blocks from reasoning models are passed back untouched; message history is never modified (L1, L3)

## Tools
- [ ] Every tool has a clear description (what it does, when to use it, what it returns); parameters have descriptions and enums (L3, L5)
- [ ] Tool results are trimmed: no internal fields, no huge blobs of text (L5)
- [ ] Tool errors go back to the model as `is_error` results instead of crashing the program (L5)
- [ ] Unknown tools, bad arguments and tool timeouts are all handled (L6)
- [ ] Tools with side effects are idempotent (idempotency keys); high-risk actions require human approval (L6, L12)

## Reliability
- [ ] Only retryable errors are retried (429 / 5xx / network), with exponential backoff + jitter; no compounding with the SDK's own retries (L6)
- [ ] Every external call has a timeout; the agent as a whole has step, token and cost limits (L4, L6, L18)
- [ ] Streaming output can be cancelled by the user, and there's a fallback when the first token times out (L13)

## Context and knowledge
- [ ] Long conversations have a compaction or summarization strategy and never hit the context window (L7)
- [ ] Long-term memory never stores secrets or sensitive personal data; users can view and delete it (L8)
- [ ] RAG answers carry citations, and the citations are validated; when nothing relevant is retrieved, the agent declines instead of making things up (L9)

## Architecture
- [ ] Fixed processes use deterministic workflows; agents are used only where open-ended decisions are needed (L11)
- [ ] Multi-agent contexts are isolated, and sub-agents return only summaries (L14)
- [ ] Agent state (messages) is serializable, so runs can be resumed, audited and replayed (L12)

## Quality
- [ ] There's an eval set (happy paths, edge cases, past incidents) that runs before and after every prompt change or model switch (L16)
- [ ] CI runs `npm test` (mock model, deterministic regression); `npm run test:real` (real model) runs on a schedule (this project)
- [ ] LLM-as-judge rubrics are written as concrete criteria, and the judge's own accuracy is spot-checked against human labels (L15, L16)

## Security
- [ ] All tool output, web content and file content is treated as **untrusted data**, with clear delimiters (L17)
- [ ] Least privilege: each task gets only the tools it needs; high-risk tools sit behind a deterministic policy gate (L17)
- [ ] Output filtering: phone numbers, ID numbers, secrets, etc. never appear in replies or logs (L17)
- [ ] API keys live only on the server, never in the frontend; separate keys per environment, rotated regularly

## Observability and cost
- [ ] Every model call is logged: feature, model, latency, tokens, cost, errors (L18)
- [ ] Cost is broken down by feature; budget alerts are set up (L18)
- [ ] Prompt caching is on: stable prefixes first (system, tools), variable content after (L18)
- [ ] Simple tasks are routed to a cheaper model or lower effort, with evals proving quality didn't drop (L11, L18)
- [ ] Prompts / replies in logs are redacted and have a retention period

## Launch and operations
- [ ] Gradual rollout: new prompts / models go to a small share of traffic first, and metrics are compared
- [ ] Prompt and model versions can be rolled back in one step (prompts are versioned too)
- [ ] There's a fallback: hand off to a human or return a canned reply when the model is unavailable
- [ ] There's a user feedback channel (thumbs up/down), and bad samples are added to the eval set
