## Production notes

- **Eval-driven development**: write the eval set first, then change the prompt / model / tools. Compare every change against the baseline and don't merge regressions. Wire it into CI, just like unit tests.
- Build the eval set from **real traffic**: frequent questions, questions that caused incidents, and edge cases. A few dozen carefully chosen cases are usually worth more than thousands of made-up ones. When something breaks in production, add it to the set.
- **If code can grade it, let code grade it**: exact match, keywords, JSON shape, which tool was called — cheap, fast and deterministic. Save LLM judges for things that need judgment, like "did it offer an alternative?" or "is the tone appropriate?".
- **LLM judges must be checkable and calibrated**: write specific rubrics, require structured JSON, and fail by default when parsing fails. Regularly spot-check against human reviewers and track agreement. By default use a judge at least as strong as the system being graded; before switching to `fast` to save money, prove it agrees with the stronger model.
- Judges have biases too: they favor longer answers, whichever option comes first, and outputs that sound like themselves. When comparing two versions, grade both orderings to reduce position bias.
- **Limit concurrency**: evals fire a lot of requests in a short time, and without a limit you'll hit rate limits (the 429s from Level 6). A worker pool plus retries is standard.
- Record per-case errors instead of letting the whole run crash. Reports should show the pass rate, the failure details and each case's raw output so you can track problems down. Anthropic Console, OpenAI Evals, promptfoo, Braintrust and LangSmith all follow this pattern.
