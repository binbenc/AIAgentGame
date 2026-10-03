## Production notes

- **Tool design is the agent's user interface** (the ACI, Agent-Computer Interface, from the SWE-agent paper): few, focused tools with names and descriptions that are obvious at a glance; output with line numbers and a length cap; errors that say **what went wrong and what to do next** ("old_str not found, check indentation, read_file first" beats "Error").
- **str_replace beats rewriting whole files**: a model rewriting a whole file drops the parts it didn't see and gets lazy with "rest of the code unchanged". The bigger the file, the riskier and the more tokens it costs. Snippet replace needs two checks: old_str must **exist verbatim** and be **unique**.
- **Find it before you change it**: give the model search (grep) and file reading. The file named in the issue isn't always where the bug is; search for the function name, then read the whole file.
- **Always run the tests**: run the existing tests after every change. Plenty of fixes "fix the issue and break something else", and only tests catch that. Better still: write a repro script / test first, confirm it fails, then confirm it passes after the fix.
- **No editing tests**: forbid it in the system prompt **and** refuse writes to `*.test.ts` in the tool layer. The prompt alone isn't enough — a model stuck on a failing test will happily "take a shortcut".
- **Minimal diff**: change only the lines that need it; no drive-by refactors or reformatting. Reviewers can follow it and the regression risk stays low.
- **Sandbox untrusted code**: agent-written code can loop forever, delete files or hit the network. In production, run it in a container (read-only mounts, no network, CPU/memory/time limits) with a clean environment every run. This project's test runner builds a fresh module system each time, but a synchronous infinite loop still hangs it — exactly why you need a real sandbox.
- **Cost**: a coding agent's context keeps growing (every step carries every file read so far). Cap the steps (maxSteps), truncate tool output, read only the files you need. mini-swe-agent scores very well on SWE-bench with about 100 lines of code and a single bash tool — a simple loop with good feedback beats a complex framework.

## Reference architecture

```
issue ──▶ system prompt (workflow: reproduce → locate → minimal edit → run tests → never edit tests)
            │
            ▼
      ┌──────────── runAgent loop (maxSteps ≈ 25) ──────────────┐
      │  model ──tool_use──▶ search_code / list_files / read_file  │
      │    ▲                 str_replace (unique match, no tests)  │
      │    └──tool_result── write_file (new files only)            │
      │                      run_tests (failures + summary, capped)│
      └────────────────────────────────────────────────────────────┘
            │ model stops calling tools
            ▼
      grader: final files + original tests + hidden tests ──▶ FAIL_TO_PASS ✓ and PASS_TO_PASS ✓
```
