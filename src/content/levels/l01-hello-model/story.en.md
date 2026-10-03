Monday, 9 a.m. You push open the glass door of **Nova Tech**, a smart-home startup. Support tickets have been growing 30% a day, and the boss has made a call: **let an AI agent handle customer support**.

> **Zhou (CTO)**: Welcome aboard! Don't reach for an agent framework just yet. Strip any agent down to the bottom and it does one thing: **send a list of messages to a model and get back a list of content blocks**. Get that rock-solid first.

> **Zhou**: I've set up a unified `chat()` interface for you. Behind it can sit Claude, GPT, DeepSeek, or our own "mock model". Today you'll write an `ask()` function. Sounds trivial, but I've seen way too many production incidents caused by "assuming `content[0]` is always text" and "never checking `stop_reason`".
