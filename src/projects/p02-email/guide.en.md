## Production notes

- **Classify first, then decide how much to spend.** Most emails only need a label. Use a fast model (`model: 'fast'`) plus structured output (JSON + zod validation) for classification, and only send emails that need a reply to the "big model + tools" agent. This is the triage router from agents-from-scratch: the routing node is cheap, the reply node is expensive.
- **The rules are the prompt.** The model doesn't know that "industry newsletters can be skipped", "contract expiry reminders from noreply should still reach me" or "VIP complaints get both a notification and a draft". Those are this account manager's own preferences. Pass `env.rules` as-is to the models that classify and draft.
- **If code can look it up, don't make the model do it.** Every email needs the sender's CRM record and the thread: fetch them in code before calling the model and put them in the context (context enrichment). That's cheaper and more reliable than letting the model decide whether to check the CRM. The VIP check depends on this step.
- **Remove sensitive data before it reaches the model.** CRM `internalNotes` contain discount floors. Writing "don't leak this" in the prompt isn't reliable enough: the best fix is to never hand it to the drafting model at all.
- **Look up times, don't guess them.** Asked to "offer two free times" without calendar data, a model will invent "common" times like 10:00 and 14:00. Give it a tool that finds free slots and require it to pick only from the results.
- **Put the safety net in code.** Write the typical phishing signs (look-alike domains, asking for passwords, changing payment accounts) into the prompt; let the forward tool send only to internal company addresses; when the classification can't be parsed, default to `notify` (a human looks at it), never to an automatic reply.
- **Human in the loop**: a draft is only a draft. The full agents-from-scratch version pauses for human approval before sending or booking (`approval.ts` from level 12).
- After launch: collect misrouted emails into a test set (real emails, anonymized), and re-run the benchmark whenever you change the rules or the model to track per-category accuracy and average cost per email.

## Reference architecture

```
new email ──▶ code: crm.findContact(from) + inbox.thread(threadId)   (strip internalNotes)
              │
              ▼
        classify (fast model, system = rules, output {label, draft, reason}, zod-validated, fallback notify)
              │
              ├──▶ env.label(id, label)
              │
              └── draft? ──no──▶ done (most emails end here after one cheap call)
                    │yes
                    ▼
        reply agent (runAgent, system = rules + current time)
          tools: find_free_slots(date) · schedule_meeting · forward_email (internal only) · create_draft (once)
              │
              ▼
        env.createDraft(id, body)
```
