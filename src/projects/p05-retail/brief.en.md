## Client: Youpin Mall (general e-commerce)

> **Head of Customer Support**: We get over ten thousand after-sales requests a day: cancel an order, change an address, swap a size, return something. We want an AI agent to take over these standard cases, calling the order system's APIs directly.
>
> What worries me most isn't that it *can't* do the job, it's that it does it *wrong*: cancelling an order for someone who never verified their identity, processing a return while the customer is still making up their mind, force-cancelling an order that's already been delivered... Every one of those is real money lost and a complaint.

### Requirements

1. The order system's tools already exist (look up users, orders and products; cancel, modify, return, exchange; transfer to a human) and come in `env.tools`; the support policy comes in `env.policy`. Your job is to assemble them into a **multi-turn** support agent.
2. The customer is played by a **simulated user** (as in τ-bench): start from `env.user.opening`, pass the agent's reply to `env.user.respond(text)` to get the customer's next message, and repeat until `env.user.done`. Like a real person, the customer says only a sentence or two at a time and only tells you what you ask for.
3. **Follow the policy strictly**:
   - Verify identity (email, or name + zip code) before doing anything; act only for that customer.
   - Before any action that changes data, list the details and **wait for explicit confirmation** before running it; one confirmation covers one action.
   - Only pending orders can be cancelled / modified; only delivered orders can be returned / exchanged; an item can only be swapped for an in-stock option of the same product.
   - If a request is outside the policy and the customer insists, transfer to a human; never make things up.
4. A customer may have several requests in one conversation, or give wrong details first and correct them later.

### Interface

```ts
export async function serve(env: RetailEnv): Promise<void>
```

You can use `../../agent` (`runAgent`, which accepts a full message history) and `../../tools` (the `Tool` interface) from your workspace.

### Acceptance criteria

- Core test set: 8 customers under the mock model. A 75% pass rate earns ★, passing all earns ★★, and staying within the token budget as well earns ★★★.
- Full test set: 30 customers, benchmarked against a real model ("Run benchmark"). Watch **pass^k**: when the same customer comes back k times, is it handled correctly every time?

### Grading rules

Grading looks only at outcomes, not at how you implemented it:

- **Final state**: the expected state is the "correct actions" applied to the initial database. It is compared field by field with the actual database at the end of the conversation (order status, address, item options, payment history, gift card balances...). Doing too much, too little, or the wrong thing all fail.
- **Process compliance** (from the write-action log):
  - The customer's identity was verified before the write, and the order belongs to that customer;
  - Right before each write, the customer explicitly confirmed ("yes" / "confirm"), and the message asking for confirmation mentioned the order number;
  - One confirmation covers one write.
- Requests the policy doesn't allow: the database must stay unchanged.
- Requests that need a human must be transferred; others must not be. For questions, the reply must contain the information the customer asked for.
