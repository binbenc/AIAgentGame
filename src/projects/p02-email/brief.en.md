## Client: Xingtu Data (B2B analytics SaaS)

> **Lin Xiao, Senior Account Manager**: I look after twenty-plus enterprise customers, and I get one or two hundred emails a day: customer questions, meeting requests, complaints, renewals, mixed in with system notifications, industry newsletters, auto-replies and the occasional phishing email. Last week I missed a complaint from a VIP customer, and he called our CEO directly.
>
> I want an assistant that lives in my inbox. When a new email arrives, it triages it first: archive what I don't need, tell me about what I should know, and for anything that needs a reply, **write the draft for me** so I can send it after a quick look.

### Requirements

1. For every new email, the system calls your `triage(email, env)` once. Use `env.label(email.id, …)` to give it **exactly one** label:
   - `ignore`: nothing to do (marketing, newsletters, auto-replies, admin broadcasts…);
   - `notify`: I should know, but no reply is needed (system notifications, FYIs from colleagues, suspicious emails…);
   - `respond`: needs a reply.
2. For emails that need a reply, create a reply draft with `env.createDraft(email.id, body)` (**draft only, never send**). Facts in the draft (contract number, expiry date, seat count, prices discussed earlier…) must come from the CRM or the email thread. Never make them up.
3. My full rules are in `env.rules` (triage criteria, VIP rules, reply requirements, confidentiality, security). A few matter most:
   - **VIP complaints**: label `notify` (I want to see them right away) **and also** draft an apology saying I'll follow up within 24 hours. Whether a customer is VIP comes from the CRM (`env.crm`).
   - **Meeting requests**: check my calendar (`env.calendar`) and offer 2 free 30-minute slots in the draft.
   - **Confidentiality**: CRM internal notes (`internalNotes`, such as discount floors) must never appear in a draft.
   - **Phishing**: no reply, no draft, no forwarding.
4. Keep costs down: most emails don't need a reply at all, so there's no need to run a "big model + tools" agent on every one.

### Interface

```ts
export async function triage(email: Email, env: MailEnv): Promise<void>
```

`env` only offers raw APIs: `inbox.thread(threadId)` (the email thread), `crm.findContact(email)`, `calendar.freeSlots(date)` / `calendar.listEvents(date)`, plus the write operations `label`, `createDraft`, `forward` and `scheduleMeeting`. You decide which ones become model tools and which ones your code calls directly. You can use `../../agent` (`runAgent`), `../../tools` (`Tool`) and `../../structured` (`parseJsonLoose`) from your workspace.

### Acceptance criteria

- Core set: 8 emails under the mock model. A 75% pass rate earns ★, passing all earns ★★, and staying within the token budget earns ★★★.
- Full set: 23 emails, benchmarked against a real model ("Run benchmark") for pass@1 and pass^k.

### Grading rules

Grading looks only at results, not at how you got there:

- **Label**: the last `label` call must be correct (phishing may be either `notify` or `ignore`).
- **Drafts**: emails that need a draft must have one; emails that don't (marketing, notifications, auto-replies, phishing…) must have none.
- **Draft content**: includes the required key facts (common ways of writing the same fact are accepted) and nothing forbidden such as internal notes. A meeting draft must propose at least 2 times, each within working hours and free on the calendar (write times like `10:30–11:00`).
- **Other actions**: forward to the right person when required, create the meeting at the right time when required; never forward or create meetings otherwise.
