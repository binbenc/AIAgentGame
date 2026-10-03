## Task

Implement in `structured.ts`:

```ts
extractTicket(email: string, maxRetries = 2): Promise<Ticket>
```

`TicketSchema` (zod) is already defined for you.

1. Write a prompt that asks the model to **output JSON only** and spells out the allowed values of each field.
2. Implement `parseJsonLoose(text)`: it should handle JSON wrapped in a ```json fence, as well as JSON with explanatory text before or after it.
3. Validate with `TicketSchema.safeParse`.
4. When parsing or validation fails: append the model's original answer as an `assistant` message, then a `user` message with the **specific error** (e.g. zod's issues), and retry.
5. Retry at most `maxRetries` times (i.e. call the model at most `maxRetries + 1` times); if every attempt fails, `throw`.

## Test scenarios
- Clean JSON: the prompt must explicitly ask for JSON
- Fenced JSON: strip the ```json fence
- Self-correction after a validation error: the retry must include the original answer and the error
- Hopeless input: once retries are used up, throw; never retry forever
