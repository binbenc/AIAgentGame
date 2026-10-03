On the agent's first day live, two complaints came in:

1. A customer asked "which of my orders have **shipped**?", and the agent listed the delivered ones too.
2. A customer wanted to cancel an order that had **already shipped**. The backend threw an exception, the agent crashed, and the customer got a 500 page.

> **Zhou**: The first problem is **tool design**. The model only understands a tool through the schema and description you write. You didn't give `status` an enum, so how would it know it can filter by status?

> **Zhou**: The second problem is **error handling**. A failing tool shouldn't crash the agent; the error should be **reported to the model as a result**: "the order has shipped and can't be cancelled". Models are good at changing course based on errors, for example by looking up the return policy instead.

> **Vera (Security Lead)**: Also, I saw the tool returning `_internalCost` (our cost price) and the warehouse notes to the model verbatim. Internal fields like that don't belong in the context: they waste tokens and risk leaking.
