The support inbox gets over a thousand emails a day. Mia (PM) wants the AI to first **triage each email into a structured ticket**, then route it to the right team automatically.

> **Mia**: I only need four fields: category, priority, a one-line summary and the order id. The intern tried it yesterday. Sometimes the model wrapped the JSON in a ```json fence, sometimes it wrote the priority as "urgent", and the backend just threw 500s...

> **Zhou**: Model output is **untrusted input**, no different from a form a user submits: parse it, validate it, and if validation fails, **feed the error back to the model so it can fix it**. That's the simplest form of "self-correction". But retries must have a cap, or one weird email can burn through your whole budget.
