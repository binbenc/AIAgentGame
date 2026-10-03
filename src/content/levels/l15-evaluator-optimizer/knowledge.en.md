## Production notes

- Evaluator-optimizer fits tasks that have **clear evaluation criteria and genuinely get better with another round**: customer-facing copy, translation, code generation (paired with tests), complex search. When the criteria can't be stated clearly, the loop just spins in place.
- **Make rubric items specific and checkable**: "state the order number" and "don't promise a date" are far more useful than "sound more professional". Ideally each item maps to one actionable piece of feedback.
- Give the evaluator **its own prompt and role**, and ideally let it see only the draft and the rubric, not how the draft was produced. That makes it less likely to "grade its own homework" generously. You can also use a cheaper model as the evaluator (`evaluatorModel: 'fast'`), but prove with evals (Level 16) that it judges accurately first.
- Don't hand the model what code can check: order number format, length and banned words are cheaper and more deterministic with a regex or a program. Save model review for judgment calls like tone and completeness.
- **Always cap the number of rounds**, and **keep the best draft**. Quality can drop after several rounds (drafts get longer, or correct parts get lost), so looking only at the last one can cost you.
- The evaluator's output is structured output too: validate the JSON, retry on failure, and **default to "not passed"** when it can't be parsed.
- Log every round's score and feedback. They make great eval data: the rubric items that fail most often tell you where the generator's prompt needs work first.
