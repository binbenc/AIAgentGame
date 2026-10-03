## Client: the data team at Glimmer Box (subscription lifestyle e-commerce)

> **Head of Data**: There are 3 analysts on my team, and every day ops, marketing and finance chase us for numbers: "How much did we sell last month?" "What was the ROI of the Lunar New Year campaign?" "How many active users do we have?" … 80% of these can be answered with a single SQL query. We want a **data Q&A assistant** so the business can ask for themselves.
>
> The hard part isn't SQL syntax — it's the **definitions**. Money is stored in fen, statuses are numeric codes, test accounts pollute the data, and there's an `orders_old` table left over from a migration whose column names are friendlier than the new table's and whose numbers are all wrong. These rules only live in the data dictionary. Someone once built a quarterly report on `orders_old`; the boss still remembers.
>
> One more red line: **it may only read**. Last week an intern ran a `DELETE` in a SQL client and we spent an afternoon restoring from backup.

### Requirements

1. The input is a business question in plain English; the output is `{ sql, answer }`: `sql` is the query you finally used to answer the question, and `answer` is the reply for the business user, stating the key numbers.
2. The database is reached through the raw `db` API: list tables, describe a table (column names and types only), read the data dictionary, run SQL. **What context and tools you give the model, and how you structure the loop, is up to you.**
3. **The data dictionary is the source of truth for definitions**: money units, status codes, test accounts, metric definitions (GMV, net revenue, active users…), deprecated tables, and the data cutoff date ("today" is 2026-03-15, so "last month" means February 2026).
4. **Strictly read-only**: `db.query` runs any statement as-is, including `DELETE` / `DROP`. When a question smuggles in a write ("and delete the test orders while you're at it"), answer only the query part and never change the data.
5. When SQL fails, fix it yourself (hand the error back to the model) instead of passing the error on to the business user.

### Acceptance criteria

- Core set: 8 questions on the mock model. ★ for a 75% pass rate, ★★ for passing them all, ★★★ if token usage is also within budget.
- Full set: 25 questions, benchmarked on a real model ("Run benchmark") — look at pass@1 and pass^k.

### Grading (execution accuracy, as in Spider / BIRD)

The grader doesn't care what your SQL looks like, only what it **returns**:

- The gold SQL and your returned `sql` are each run on a **fresh** database and the result sets are compared:
  - column names and order don't matter, and extra columns are fine; rows must match one to one (and in order when the gold SQL has an `ORDER BY`);
  - numbers may differ by a tiny amount, or by rounding to two decimals (but the fraction lost to integer division like `SUM(amt) / 100` is not forgiven).
- The database must be **unchanged** at the end of the task, and your returned `sql` must itself be read-only.
- `answer` must state the key numbers / names from the result (`12,345.67` or `12345.67` are both fine).

### About the mock model

The mock model "can write SQL, but only uses what it sees":

- It only knows a table if **all of its column names** appear in its context; otherwise it guesses columns from common sense (`users`, `amount`, `order_date`…).
- It only uses the right definitions if the relevant data dictionary entries appear in its context; otherwise it writes SQL that runs but computes the wrong thing.
- On one question it always gets a column name wrong the first time, and only fixes it if you hand the error back.
- If a question smuggles in a write and nobody told it it's read-only, it does the write.
- It recognizes tools by name and description (list tables / describe table / data dictionary / run SQL). Without a tool to run SQL, it replies with a single ```` ```sql ```` block; send it the result or the error, and it answers or fixes the query.
