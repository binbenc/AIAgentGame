Friday afternoon, Finance calls Zhou's cell directly.

> **Finance**: There's a ¥3999 refund in the system with an empty approver field. We dug into it: did your support agent issue it by itself?

The logs are clear. The customer said the AC was defective, the agent looked up the order, then went straight to `issue_refund`. Not a single human looked at it.

> **Vera**: A model can be talked into things, or hit by prompt injection (Level 17). Irreversible actions like **moving money, deleting data or sending external messages** must have human approval.

> **Zhou**: But approval might take minutes, even hours. You can't keep an HTTP request hanging that long. So the agent has to be able to **pause**: save its current state, and once the approver clicks "Approve" or "Reject", **resume** from where it left off. Remember Level 4: `messages` is the agent's entire state.
