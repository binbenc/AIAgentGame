## Production notes

- **Tools are the agent's API, and the model is the client.** Design them like an API for humans: clear names, few and well-defined parameters, enums to constrain values, and error messages that point to the next step.
- Size tools around **tasks**, not backend endpoints. `search_orders(email, status)` beats `find_customer` + `list_orders` + letting the model filter: fewer steps, more reliable, fewer tokens.
- **Project / trim** results: don't dump internal fields, huge text or binary data into the context. Paginate long lists and tell the model how to get the next page.
- Return errors **as results** (`is_error: true`), worded as actionable guidance, e.g. "The order has shipped and can't be cancelled; you can request a return after delivery".
- Tools with side effects (cancel, refund, send email) need **idempotency** (calling twice doesn't do it twice) and **approval** (Level 12).
- Once you have many tools (dozens or more), pick tools dynamically per scenario or use tool search instead of stuffing them all in.
