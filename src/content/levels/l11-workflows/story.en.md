Month-end close. Qiang drops the bill on Zhou's desk:

> **Qiang**: The support agent's model bill went up 4x this month. I spot-checked the logs. Even for "where's NV-100001?" it thinks, calls a tool, thinks again, then writes a reply. Three calls, on the most expensive model.

> **Mia**: Moderation is slow too. Every message gets checked for privacy, abuse and prompt injection, and the three checks run one after another. Users wait an extra second or more.

> **Zhou**: Not every problem needs an agent. **If you know the path in advance, hard-code it.** That's a workflow. Use a cheap, fast model to classify; if it's "track my order", call the API directly. Chain multi-step processing together and put code checks between the links. Run independent checks in parallel.

> **Zhou**: Agents are for problems where you don't know what the next step is. If a workflow can solve it, don't use an agent.
