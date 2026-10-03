## Production notes

- **Retrieval quality sets the ceiling.** Nine times out of ten, a wrong answer means retrieval missed the right article. Open the Trace to see what each question retrieved (print the hits with `log()`).
- **Give the model the metadata**: title, update date, article type. The model can only judge from what it sees: how else would it know which article is outdated?
- **Validate citations**: only accept chunks that were actually retrieved, and drop any source the model made up.
- **Make refusals detectable**: agree on one fixed refusal sentence so code can reliably turn it into `refused: true`.
- **Refuse on low scores**: when the top retrieval score is below a threshold, don't call the model. Calibrate the threshold on the test set: too high and you refuse real questions, too low and small talk reaches the model.
- **Build the index once**: cache it while the docs don't change (for example with a `WeakMap`).
- Going further: query rewriting (turn casual questions into the docs' wording), hybrid retrieval (BM25 + vectors), reranking, category filters. Benchmark mode lets you measure what each one buys you.
- After launch: add thumbs-down questions to the test set, and re-run the benchmark whenever the docs change to catch regressions.

## Reference architecture

```
question ──▶ retrieve top-k (BM25, title + body) ──▶ score < threshold? ──yes──▶ refuse (no model call)
                                                    │no
                                                    ▼
          context: [chunk id] (title, updated date) + text ──▶ model (docs only / latest wins / cite sources / fixed refusal)
                                                    ▼
                       parse answer → validate citations → { answer, citations, refused }
```
