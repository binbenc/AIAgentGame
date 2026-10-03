## Production notes

- **The context window is a hard limit; cost is a soft one**. A multi-turn chat resends the whole history every turn, so total tokens grow roughly **quadratically** with the number of turns. Give each session a token budget and leave headroom for output tokens.
- Count before you send: Anthropic has a `messages.countTokens` endpoint; with OpenAI you can estimate locally with `tiktoken`. **Tool definitions, the system prompt and images all count**, not just messages.
- Common compaction strategies: ① sliding window (drop the oldest turns; cheapest, but the agent forgets); ② **summary + last N turns** (this level, and the most common); ③ clear old tool results (big JSON blobs usually take the most room; Anthropic's context editing does this automatically); ④ extract key facts into external memory (next level).
- **Only cut on turn boundaries**: `tool_use` and `tool_result` must come in pairs, and the first message must be from the user. Cut wrong and you get a 400.
- Summaries can use a cheap, small model (`model: 'fast'`). The summary prompt should name what must be kept (order numbers, amounts, promises made to the user, open issues) and say "don't make anything up".
- Summaries grow too: when you compact again, fold the old summary in, and set `max_tokens` on the summary call.
- Compaction **invalidates the prompt cache** (the prefix changes). So don't compact every turn; wait until you're near the threshold and then compact well below it, which is better for both cache hit rate and cost.
