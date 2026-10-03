At the Monday stand-up, **Mia (PM)** tosses over a request:

> **Mia**: Annual planning is next week and I need a competitive research brief: smart locks, robot vacuums and smart speakers, comparing price, key specs and what users say. Can an agent run this for me?

You hand all three tools (web search, the spec database and e-commerce reviews) to a single agent. It runs for 3 minutes: nine raw web pages, spec sheets and review lists all pile up in one context. In the second half it starts attributing the lock's price to the speaker, and the token count on the bill makes you wince.

> **Zhou**: An agent's context is its "working memory". Pour tens of thousands of words of noise into it and of course it gets confused. Try this instead: an **orchestrator** splits the task first, and each subtask goes to a **brand-new worker**. It gets only the tools it needs, does its digging in its own clean context, and **hands back only a summary**. The workers run at the same time, and the orchestrator reads just the summaries to write the conclusion.

> **Zhou**: One more thing: if one of the three workers dies, you can't throw away the whole report. Tell Mia which part is missing data and deliver the rest as usual.
