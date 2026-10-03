## Production notes

- **The schema is the model's eyes**: the model doesn't know what your tables and columns are called. With a small database (a dozen tables) put the full schema in the system prompt; with a large one (hundreds of tables) do **schema linking**: retrieve the tables and columns relevant to the question and put only those in context — otherwise it's expensive and the model picks the wrong tables.
- **The data dictionary matters more than the schema.** The BIRD benchmark specifically tests "external knowledge": money units, status codes, metric definitions, deprecated tables — none of which you can see in column names. Give the model the data dictionary (or the entries relevant to the question) and tell it in the system prompt that the dictionary's definitions win. In real projects this dictionary usually has to be completed together with the business; it's the most valuable asset a data assistant has.
- **Anchor relative dates**: "last month" and "the last 7 days" must be relative to an explicit "today" (the data cutoff / report date). Don't let the model use `date('now')` — data lags, and tests can't be reproduced.
- **Read-only is enforced in code, not in the prompt**:
  - Most reliable: a read-only account / connection at the database level (`?mode=ro`, SELECT-only grants);
  - Application-level guard: validate SQL before running it — allow a single `SELECT` / `WITH` only, reject multiple statements and `INSERT / UPDATE / DELETE / DROP / ALTER / ATTACH / PRAGMA`, and return the reason to the model;
  - Also say "read-only, refuse writes" in the prompt, so the model explains it properly in its answer instead of retrying over and over.
  - The SQL you return to the user (or downstream) goes through the guard again.
- **Execution feedback loop**: when SQL fails, hand the error back to the model verbatim (`no such column: created_at`); it usually fixes it in one try. This is the main payoff of building Text-to-SQL as an agent (a loop with a `run_sql` tool) instead of one-shot generation. Cap the steps so trial and error doesn't burn money.
- **Keep results small**: truncate query results to a few dozen rows before giving them to the model, and tell it the total row count and whether it was truncated. For big result sets, the model should rewrite the query as an aggregate rather than stuffing thousands of rows into context.
- **Answers come from execution results**: every number in the answer must come from a query that actually ran — don't let the model "estimate". The returned `sql` should be the query that produced those numbers, so analysts can double-check it.
- **Evaluate with execution accuracy**: compare result sets, not SQL text — a question has countless correct queries. Keep adding real questions from the business (with gold SQL confirmed by an analyst) to the task set, and rerun the benchmark every time you change the prompt or the model.
- Going further: few-shot (retrieve gold SQL for similar questions as examples), multiple candidates + voting on execution results (self-consistency), clarifying ambiguous questions before querying, auto-charting results.

## Reference architecture

```
question ──▶ system prompt
              ├─ role + rules: read-only / dictionary definitions win / cutoff date / fix errors / append the SQL
              ├─ <schema>           listTables + describeTable (large DB: retrieve tables relevant to the question)
              └─ <data_dictionary>  dataDictionary (large DB: retrieve relevant entries)
                    │
                    ▼
      ┌──────── runAgent loop (maxSteps ≈ 8) ────────┐
      │  model ──tool_use──▶ run_sql(sql)             │
      │    ▲                 ├─ read-only guard: single SELECT / WITH, otherwise refuse with the reason
      │    │                 ├─ db.query(sql)
      │    └──tool_result── { rows ≤ 50, rowCount, truncated } or the error message
      └───────────────────────────────────────────────┘
                    │ model answers + ```sql```
                    ▼
      take the final SQL (through the guard again, else the last query that ran) ──▶ { sql, answer }

Grading: run the gold SQL and your sql on a fresh DB ──▶ same result set? DB unchanged? key numbers in the answer?
```
