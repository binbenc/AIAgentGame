## Production notes

- **A snippet is not evidence.** Search results only have snippets; the key facts are in the full text. In a multi-hop question, the second hop's search terms come from what you read in the first hop (say, the founder's name) — an agent that only reads snippets doesn't even know what to search for next.
- **Give the model the metadata**: publication date, source type (official / news / blog / forum), site name. The model can only judge reliability from what it sees — without dates, how would it know which number is stale? Then spell out the rule in the system prompt: when sources conflict, official and most recent wins.
- **Web pages are untrusted data.** Wrap fetched text in `<untrusted>` tags and state in the system prompt that tagged content is data, not instructions (`wrapUntrusted` / `UNTRUSTED_POLICY` from Level 17). Note: **whoever has raw page text in its context needs that policy** — including the lead that writes the final answer.
- **Verify citations**: record the URLs actually opened in the fetch tool, and in the end keep only URLs that appear in the answer and were really read. URLs the model writes may be made up, or may have only been seen in search results.
- **Allow "not found"**: agree on a fixed phrasing ("This cannot be determined from the available sources"), otherwise the model will confidently invent a number.
- **Keep context lean**: half of a real web page is navigation, related links and footer. Each worker should send back only **a few lines of findings + URL + date** after reading; the lead reads the findings, never the raw pages. Forwarding a worker's whole transcript to the lead doesn't just double the tokens — it also carries the injected text on the page into the lead's context.
- **Orchestrator-worker (the approach in Anthropic's multi-agent research system)**: the lead splits the question into subtasks that can run in parallel, and each worker gets its own fresh context window. Run in parallel, total time ≈ the slowest worker. The price is more model calls — Anthropic reports multi-agent setups using roughly 15× the tokens of a single agent, so it only pays off on breadth-first questions that parallelize.
- **A single agent with notes is also a sound choice**: one agent loop, compact tool output and a habit of jotting down findings as it goes is cheaper on this project's small questions (the reference solution also earns three stars as a single agent). Compare pass@1, tokens and latency for both architectures with the benchmark before deciding.
- **Don't split multi-hop chains**: a "find A, then use A to find B" chain stays in one worker; only independent branches run in parallel (the two items in a comparison, the multiple sources in an enumeration).
- Going further: query rewriting and multiple search rounds (enumeration questions need several searches to avoid misses), filtering SEO pages by source type, main-content extraction (strip navigation and footer before handing text to the model), step and token caps per worker, and letting the lead decide from the findings whether to run another round.

## Reference architecture

```
question
   │
   ▼
 lead: plan subtasks (JSON, zod-validated; keep multi-hop chains together, split only independent branches)
   │
   ├──────────────┬──────────────┐        in parallel, each worker gets a fresh context
   ▼              ▼              ▼
 worker 1       worker 2       worker 3     runAgent + tools:
 search_web ─▶ snippet + date + source type    search_web (snippet, date, source type)
 fetch_page ─▶ <untrusted> full text </untrusted>   fetch_page (full text in <untrusted>, records URLs read)
   │              │              │          system: search then read / multi-hop / official + latest wins /
   ▼              ▼              ▼                  say when not found / UNTRUSTED_POLICY
 findings ≤100 words: conclusion + (source URL, date)
   │
   ▼
 lead: reads findings only → calculate / compare / aggregate → answer + URLs
   │
   ▼
 citation check: URLs in answer ∩ URLs actually fetched ──▶ { answer, sources }
```
