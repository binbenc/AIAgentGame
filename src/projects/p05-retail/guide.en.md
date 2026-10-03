## Production notes

- **The policy is part of the prompt.** The model doesn't know your company's rules. Leave the policy out of the system prompt and it will "helpfully" skip identity checks, cancel orders straight away, and even process a return on its own initiative after a cancellation fails.
- **Carry the full conversation history into the next turn**, tool calls and tool results included. Pass only the last message and the model forgets who the customer is, what it looked up, and which action the customer confirmed. `runAgent` accepts a message array, and the `messages` it returns are the starting point for the next turn.
- **Confirmation means stopping to wait for the user.** Once the model has listed the details, the turn should end and the customer gets to speak; the write tool is called in the next turn, after the customer says "yes". If your loop keeps going before the customer replies, the confirmation is meaningless.
- **One confirmation covers one action.** A "yes" authorizes only the thing that was just listed. Batching actions, or doing one more thing while you're at it, is an incident in production.
- **Put limits on the loop**: a cap on conversation turns, a cap on tool calls per turn, and a fallback for empty replies. Real models sometimes go in circles, and users give up.
- **A policy in the prompt ≠ a policy that's followed.** The τ-bench paper found that even the strongest models score far lower on pass^8 (the same task succeeding 8 runs in a row) than on pass^1 in the retail domain: agents are not reliable across repeated trials. Common reinforcements in production systems:
  - **Deterministic guards**: wrap the write tools in code that checks whether identity was verified, whether the order belongs to that user, and whether the customer confirmed in this turn; on a violation, return an error to the model instead of trusting it to behave;
  - **Structured confirmation**: the program renders a confirmation card (order number, items, amount), and the write only goes through after the customer clicks "Confirm";
  - **State-based evaluation**: like τ-bench, compare the database at the end of the conversation with the expected state instead of judging whether the reply "sounds right". Run the same task several times and look at pass^k.
- After launch: turn every conversation that went wrong into a new test customer (simulated-user persona + expected actions), and rerun the benchmark whenever you change the prompt or the model.

## Reference architecture

```
                 ┌──────────────────── conversation loop (≤ MAX_TURNS turns) ─────────────────────┐
opening ──▶ messages ──▶ runAgent(messages, env.tools, { system: role + policy + how to work })    │
                 ▲            │  within each turn: model ⇄ tools (users / orders / products → writes) │
                 │            ▼                                                                     │
                 │      res.messages (tool calls and results, kept whole) + res.output (to customer)│
                 │            │                                                                     │
                 └── push(customer reply) ◀── env.user.respond(output) ──▶ done? ──yes──▶ end       │
                 └──────────────────────────────────────────────────────────────────────────────────┘

Policy in system: verify identity → look up orders / products → list details, ask to confirm → (next turn) customer says "yes" → call the write tool → report the result
Advanced: wrap the write tools in a deterministic guard (identity / ownership / confirmed this turn) that returns an error to the model on a violation
```
