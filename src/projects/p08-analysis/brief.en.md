## Client: FreshDash (neighborhood grocery chain), Ops Analytics

> **Head of ops analytics**: Every day we answer dozens of "small questions": how much did East sell last quarter, how many points did February drop month over month, what's the payment conversion of iOS users, what's this round's NPS… The data sits in a few CSV exports, and an analyst could script any of these, but we simply don't have the people.
>
> We tried pasting the data into a chatbot. It answered fast and confidently — and every number was wrong: it looked at the first few rows and "estimated". What we want is an analysis agent that **writes code to compute the numbers**, like Code Interpreter, with reproducible code behind every number.
>
> Also, our data is dirty: some people write "East", others "east"; the old POS system exports amounts with thousands separators; analytics events get reported twice; surveys contain "N/A". Our analysts know all these traps, and the agent has to know them too.

### Requirements

1. The input is an analysis question; the output is `{ answer, code, explanation }`:
   - `answer`: a number for numeric questions (rounded to the requested decimal places), a string for categorical ones;
   - `code`: **the complete code that computed this answer**, which must have actually been run through `env.runCode`;
   - `explanation`: a sentence or two on the method.
2. The environment provides three CSVs (`sales` daily store sales, `events` app analytics, `nps` satisfaction survey) and a raw API: list datasets, preview the first rows, run code in a sandbox. **Which tools you give the model and how you structure the loop are up to you.**
3. Sandbox: `runCode(code)` runs TypeScript / JavaScript and returns the `console.log` output; errors are appended to the output (never thrown). Read data with `import { load } from 'data'`:
   - `load(name)` parses the CSV by header into an array of rows, and **every value is a raw string** (empty is `''`; commas and inconsistent spellings are kept as-is); `raw(name)` returns the CSV text; `datasets()` returns the dataset names.
   - Runs synchronously, no top-level `await`; output over 4000 characters is truncated; an infinite loop hangs the whole run until it times out.
4. **Cleaning rules** (the ops analytics team's conventions):
   - Count duplicate records once: `sales` by whole row, `events` by `event_id`, `nps` by `resp_id`;
   - Missing / invalid values (empty, `N/A`, scores outside 0–10) are excluded, never treated as 0;
   - Different spellings of regions, platforms and cities (case, suffixes like "Region" / "City") are merged into the canonical name (East, iOS, Shanghai…);
   - Numbers may have thousands separators; strip them before converting.
5. Format requirements in the question ("two decimal places", "answer with the percentage as a number", "comma-separated") must be followed.

### Acceptance criteria

- Core set: 8 questions with the mock model. 75% pass rate earns ★, all passing earns ★★, and staying within the token budget earns ★★★.
- Full set: 23 questions, benchmarked with a real model ("Run benchmark") for pass@1 and pass^k.

### Grading (like DABench, results only)

- **Correct answer**: matches the gold answer the grader computes with trusted code (numeric answers may be off by 1 in the last digit; categorical answers compare names; list answers compare order). When the question asks for N decimal places, `answer` may not have more than N.
- **Answer comes from code**: at least one `runCode` run happened in this task, and the returned `code` is one of the snippets that ran — no "eyeballing" or "estimates".
- **Reproducible**: the grader reruns your returned `code` in a fresh sandbox, and the answer must appear in the **last few lines** of its output.

### About the mock model

The mock model "writes analysis code, but only handles problems it has seen with its own eyes":

- It only writes analysis code once all of a dataset's column names have appeared in the context (previewed or printed); otherwise it can only estimate a number.
- It only cleans dirty data it has **seen evidence of** (it merges region spellings only after seeing `east`, strips separators only after seeing `"12,345.60"`, handles missing values and duplicates only after seeing something like "empty 12" or "duplicates: 30"). The first 20 rows of every dataset are clean; it writes a profiling snippet first only when asked to check data quality.
- On one question its first code always fails; it fixes it only when you hand the error message back.
- It recognizes tools by name and description (run code / preview data / list datasets). Without a code-running tool: if you ask it to write code, it replies with a ```` ```ts ```` code block and waits for you to send back the output; otherwise it just estimates a number.
- Its code always prints `ANSWER: value` last; the first line of its reply is "Answer: value".
