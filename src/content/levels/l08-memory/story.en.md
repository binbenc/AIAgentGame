Compaction fixed single conversations. But Mia brings in a new one-star review:

> "Last week I told you I'm out during the day and visits have to be after 8 pm. Today I book an installation and your AI schedules it for 10 a.m. again!"

> **Mia (PM)**: Customers feel like we "never learn". Every new session, the agent forgets them completely.

> **Zhou**: The context window is only **working memory**; it's wiped when the session ends. To remember people, the agent needs **long-term memory**: when a conversation reveals a lasting preference, save it; when the next session starts, look up the relevant memories and put them in the system prompt.

> **Vera (security lead)**: Let's be clear up front: not everything goes into the memory store. Yesterday I saw someone in staging tell the agent to "remember my credit card number", and it did. Long-term memory gets injected into prompts again and again, and it's written to disk. **Passwords, card numbers and ID numbers never go in.** And user A's memories must never show up in user B's conversation.
