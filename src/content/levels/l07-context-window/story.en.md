Monday morning, the support lead drops a screenshot into the group chat: a customer had been talking to the agent for over forty turns, and when they asked question 41, all that was left on the page was one line of red text: `400 prompt is too long`.

> **Qiang (ops on-call)**: It's not just the errors. I checked the bill: every extra turn in a long chat **resends the entire history**. A 40-turn chat doesn't cost 40× a single turn, it costs closer to 800×.

> **Mia (PM)**: But customers do talk for a long time. And what annoys them most is "I gave you my order number in the very first message, why are you asking again?"

> **Zhou**: The model has no memory. All it "remembers" is the messages you send it this time. The window is finite, so you have to manage it yourself: **count tokens before you send; when you're over, condense the early conversation into a summary and keep the last few turns verbatim**. Write the summary well and the order numbers and names won't get lost.

> **Zhou**: Watch where you cut. Never separate a `tool_use` from its `tool_result`. The API will reject you outright.
