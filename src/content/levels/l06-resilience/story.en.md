The night before Singles' Day, traffic is up tenfold. The monitoring wall is solid red:

- The model API starts returning **429 Too Many Requests**, with the odd **503** mixed in;
- Under pressure, the model "invents" a tool that doesn't exist: `delete_all_orders`;
- Once, the model sent tool arguments that were half a JSON object;
- The report service hung, and the agent just sat there waiting until the user closed the page.

> **Qiang (ops on-call)**: I got paged four times at 3 a.m. Please, make it handle this stuff on its own.

> **Zhou**: First principle of production: **external dependencies will fail, and the model will make mistakes**. Back off and retry errors that are retryable, fail fast on the ones that aren't; turn the model's mistakes into feedback so it can correct itself; and put a timeout on every wait.
