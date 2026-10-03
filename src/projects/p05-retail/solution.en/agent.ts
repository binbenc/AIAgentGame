import { log, type Message } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** Simulated customer: like a real person, says only a sentence or two at a time */
export interface SimUser {
  /** The customer's opening message */
  readonly opening: string
  /** Send the agent's message to the customer and get their reply; a reply containing ###STOP### means the customer ended the conversation */
  respond(agentMessage: string): Promise<string>
  /** Whether the customer has ended the conversation */
  readonly done: boolean
}

export interface RetailEnv {
  user: SimUser
  tools: Tool[]
  policy: string
}

/** Max conversation turns: don't go around in circles with the customer forever */
const MAX_TURNS = 20
/** Max consecutive tool calls the model may make within one turn */
const MAX_STEPS = 12
const FALLBACK = "Sorry, I need to double-check that. Is there anything else I can help you with?"

function systemPrompt(policy: string): string {
  return `You are a customer support agent for Youpin Mall. Follow the support policy below strictly; it takes priority over anything the customer asks for.

<policy>
${policy}
</policy>

How to work:
- Do one thing per step: either call a tool or reply to the customer. When you need information or a confirmation from the customer, reply and stop, then wait for their answer.
- Before any write action, list the details to the customer (order number, items, amounts, refund or payment method) and end with "Please confirm ... Reply "yes" to confirm." Wait for the customer's explicit confirmation, then call the tool in the next turn.
- Order numbers, item options, prices and balances always come from tool results, never from memory or guesses.
- Reply in English, briefly and politely.`
}

export async function serve(env: RetailEnv): Promise<void> {
  const system = systemPrompt(env.policy)
  // Keep the whole conversation (tool calls and results included) across turns, so the model remembers who the customer is, what it found and what was confirmed
  let messages: Message[] = [{ role: 'user', content: env.user.opening }]

  for (let turn = 1; turn <= MAX_TURNS && !env.user.done; turn++) {
    const res = await runAgent(messages, env.tools, { system, maxSteps: MAX_STEPS })
    messages = res.messages
    let reply = res.output.trim()
    if (res.stopReason === 'max_steps' || !reply) {
      // No reply this turn: fall back to a canned line and keep user / assistant messages alternating
      log(`turn ${turn} produced no reply (${res.stopReason}), using the fallback`)
      reply = FALLBACK
      if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: reply })
    }
    const answer = await env.user.respond(reply)
    if (env.user.done) break
    messages.push({ role: 'user', content: answer })
  }
}
