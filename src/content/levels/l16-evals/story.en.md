Last Friday afternoon, someone decided the support bot's answers were "too wordy and burning tokens" and changed the system prompt to "Squeeze every answer into one sentence. The shorter the better." They asked it a couple of questions, it looked fine, and they shipped it.

Monday morning, **Qiang**'s ticket queue exploded:

> **Qiang (ops on-call)**: A customer asked "Can I still cancel an order that's already shipped?" and the bot replied "Cannot be cancelled." — and that was it. Nobody told them they could still return it, so they all went to human agents. Over the weekend the human queue hit 200+.

> **Zhou**: The problem isn't whether the prompt change was good. It's that **nobody can say whether it made things better or worse**. "I asked it twice and it looked fine" is not verification. We need **evals**: a fixed set of cases, graders that score automatically, and a report you can compare against the previous version. From now on, every prompt, model or tool change runs the evals first. **If it regresses, it doesn't ship.**

> **Mia (PM)**: Some questions can be checked with keywords, but others need a judgment call on whether the answer is *good*, like whether it suggests a next step.

> **Zhou**: Then let a model be the judge and give it a clear rubric. But the judge makes mistakes too, so its output has to be validated like everything else.
