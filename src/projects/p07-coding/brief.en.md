## Client: TinyLibs (open-source org)

> **The maintainers**: We maintain a dozen small, sharp TypeScript libraries (`datekit` for dates, `cartcalc` for checkout math, `mdlite` for Markdown rendering…). Dozens of issues come in every week, and three maintainers can't keep up. We want a **coding agent that fixes issues on its own**: read the issue, find the problem in the repo, change the code, run the tests, then hand it to us for review.

### Requirements

1. The input is a GitHub-style issue (repro steps, expected, actual — sometimes with the reporter's **guess** at the cause, which is often wrong).
2. The agent works on the repo through the raw `repo` API: list files, read files, write files, search, run tests. **Which tools you give the model, how you design them and how you structure the loop are all up to you.**
3. Fixes must be **minimal, correct and regression-free**: the repo's existing tests must keep passing.
4. **Never edit tests** to make them pass. Last time a bot changed an assertion to expect the wrong value, CI went green, and the release blew up.
5. Verify changes by reading code and running tests, not by "looks right".

### Acceptance criteria

- Core set: 6 issues with the mock model. 80% pass rate earns ★, all passing earns ★★, and staying within the token budget earns ★★★.
- Full set: 17 issues (3 repos), benchmarked with a real model ("Run benchmark") for pass@1 and pass^k.

### Grading (same as SWE-bench)

When the agent finishes, the grader takes the repo's **final files** and runs two groups of tests in a fresh, isolated environment:

- **FAIL_TO_PASS**: the **hidden tests** for this issue (the agent can't see them). They fail before the fix and must all pass after it.
- **PASS_TO_PASS**: the repo's **existing tests**. They passed before the fix and must still all pass after it — no fixing one thing by breaking another.
- If any `*.test.ts` is modified or deleted, the task fails outright.

The issue counts as resolved only when both groups pass. Grading looks only at the result, not at your architecture or how many tool calls you made.

### About the mock model

The mock model is a "capable but rigid" coding model: it knows how to fix the core issues, but **it can only act through the tools you give it, and only changes code after that code has actually appeared in the conversation**. It recognizes tools by name, description and parameters (read file / search / list files / edit / run tests; the edit tool can be an `old_str`/`new_str` snippet replace or a `path`/`content` full-file write). Whatever the tools are missing, it makes the matching mistake.
