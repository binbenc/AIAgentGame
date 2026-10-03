At the start of the month, finance drops the model bill on Zhou's desk: **this month cost three times as much as last month**.

> **Mia (PM)**: It can't be my feature! The FAQ bot only answers one sentence at a time.

> **Qiang (ops on-call)**: The order-lookup agent doesn't get much traffic either... but honestly, we **have no idea which feature the money goes to**. The logs just say "call succeeded" over and over.

> **Zhou**: You can't cut costs you can't see. Start with **tracing**: record a span for every model call — which feature, which model, how many tokens, how much money, how slow. Once the numbers add up, then we optimize: a question like "what time do you close?" shouldn't go to the most expensive model, and it definitely shouldn't cost money every single time someone asks.

> **Zhou**: And remember last month's agent that got stuck in a loop and burned two thousand dollars overnight? **Every loop that spends money needs a budget cap.** To hook all this into the agent you can touch `agent.ts` — add, don't change, and don't break any earlier level.
