## Production notes

- **Numbers must come from code**. LLMs are great at writing pandas / JS, and terrible at mental math over thousands of rows. Give the model a code-running tool (Code Interpreter, a Jupyter kernel, a sandbox container) and say "no estimates" explicitly in the system prompt.
- **Profile first, then analyze**: `head()` only shows the first rows, and dirty data usually hides further down. Before the real analysis, profile the data with code: empty values per column, duplicate rows, every value of the category columns, number formats. Only when you see `east` next to `East` do you know they need merging. Many teams make this a standard "data card" that's automatically attached to the context.
- **Write the cleaning rules down and give them to the model**: dedup keys, how to treat missing values (drop or zero?), canonical category names, unit conversions — these are business conventions the model can't guess. It's the same thing as the data dictionary in Text-to-SQL.
- **Hand errors back to the model verbatim**: the model fixes `ReferenceError: median is not defined` at a glance. If the tool swallows the exception and just says "run failed", the model can only guess.
- **The answer is the execution result, and it's reproducible**: have the code print the final answer last (e.g. `ANSWER: value`) and take the answer from the output instead of letting the model "retell" it — miscopied digits and extra decimal places are common when retelling. Return complete, standalone code so anyone can rerun it during an audit.
- **Keep output lean**: print summaries, not whole tables; truncate long output in the tool layer and tell the model to rewrite the code. A context stuffed with raw data is expensive and drowns the model.
- **A sandbox is mandatory**: model-written code can loop forever, eat all the memory, read and write files, or hit the network. In production, run it in an isolated process / container (no network, read-only data, CPU / memory / time limits) with a clean environment every run. This project's sandbox builds a fresh module system each time but can't interrupt a synchronous infinite loop — exactly why you need real isolation.
- **Follow the format**: benchmarks like DABench ask for "two decimal places" or "answer as a percentage". Pass the question's format requirements to the model verbatim, and validate again before returning (type, decimal places).
- Going further: keep intermediate variables across steps (a stateful kernel), generate charts automatically, confirm the definition first on ambiguous questions, and turn common cleaning steps into a reusable function library for the model.

## Reference architecture

```
question ──▶ system prompt
              ├─ dataset catalog (listDatasets, included once)
              ├─ sandbox notes: import { load } from 'data', values are strings, synchronous
              ├─ cleaning rules: dedup keys / missing values / canonical names / thousands separators
              └─ workflow: preview → data quality check → compute with code → fix errors → print ANSWER → reply "Answer: …"
                    │
                    ▼
      ┌──────────── runAgent loop (maxSteps ≈ 10) ─────────────┐
      │  model ──tool_use──▶ preview_dataset(name, n)           │
      │    ▲                 run_code(code) ──▶ env.runCode      │
      │    │                   └─ record { code, output }        │
      │    └──tool_result── output (truncated) / errors verbatim │
      └──────────────────────────────────────────────────────────┘
                    │
                    ▼
      take the last successful run that printed ANSWER: answer = the value in its output (as a number), code = that snippet
                    ▼
      grading: answer ≈ gold? code was run? rerun code in a fresh sandbox — is the answer in the last lines?
```
