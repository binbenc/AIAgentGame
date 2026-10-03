## Client: Aurora Drive (cloud storage SaaS)

> **Head of Product**: Our help center has 40-odd articles, but nobody reads them. Support answers "how much space does the Free plan have?" thousands of times a day. We want an AI Q&A assistant on the help center home page.

### Requirements

1. Users ask questions in plain language, and the assistant answers **only from the help center articles**.
2. Every claim must come with a **source** (a cited article), so users can check it and we can trace mistakes.
3. Some articles are **outdated** (the 2024 price list is still online, for example). Answers must follow the **latest** version.
4. If the articles don't cover something, say "no information" rather than **making anything up**. Last time a competitor's bot quoted the wrong prices, users posted screenshots all over social media.
5. Questions unrelated to the product (write a poem, what's the weather…) get refused right away, **without spending a model call**.

### Acceptance criteria

- Core set: 8 questions under the mock model. A 75% pass rate earns ★, passing all earns ★★, and staying within the token budget earns ★★★.
- Full set: 30 questions, benchmarked against a real model ("Run benchmark") for pass@1 and pass^k.

### Grading rules

- Answerable questions: the answer contains every key fact and cites the right article. It must **not** cite articles that don't exist, and must **not** rely on outdated articles.
- Unanswerable questions: `refused: true`, with no citations.
- Off-topic questions: refuse, and also **make no model calls**.
