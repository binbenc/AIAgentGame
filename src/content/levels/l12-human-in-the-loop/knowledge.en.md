## Production notes

- **Tier tools by risk**: read-only (lookups) → reversible writes (changing an address) → irreversible or money-moving actions (refunds, deletions, outbound email). Only the last tier needs human approval. Otherwise approvers drown in "Approve" buttons and end up clicking them with their eyes closed.
- Approval rules can be fine-grained, for example "refunds ≤ ¥200 are auto-approved, anything above needs a supervisor". Write those rules in code; don't expect the model to judge them.
- **State must be serializable.** Approval might take hours, and the service may restart or scale in the meantime. Store the state in a database (keyed by run id) so any machine can pick it up and resume. LangGraph's `interrupt()` + checkpointer and the OpenAI Agents SDK's `needsApproval` follow the same idea.
- The approval UI must show **what the model actually wants to do**: the tool name, the full arguments, the model's stated reason, and relevant context (the order amount, who the customer is). Approvers shouldn't have to dig through logs.
- A rejection is not an exception, it's a **result**: give the reason to the model as an `is_error` tool_result, and it will adjust its plan or tell the user honestly.
- Guard against **double execution** on resume: an approval clicked twice, or a crash and retry mid-resume, can both issue the refund twice. Give side-effecting tools an idempotency key (Level 6) and check whether a tool_use_id was already processed before running it.
- The approval records are your audit log: who approved which call, when, and with what arguments. Keep them for compliance.
