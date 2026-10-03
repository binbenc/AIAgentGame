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
  /** The customer contacting support */
  user: SimUser
  /** Ready-made store tools: look up users / orders / products, cancel, modify, return, exchange, transfer to a human... */
  tools: Tool[]
  /** Customer support policy (Markdown) */
  policy: string
}

/**
 * Entry point of the retail support agent: start from env.user.opening and talk with the customer over multiple turns until they end the conversation (env.user.done).
 * This is a "project": there's no TODO list and the architecture is up to you. Read the brief first, then look at the task list.
 */
export async function serve(env: RetailEnv): Promise<void> {
  // The most naive version: it can chat, but every turn is a brand-new conversation (the model doesn't remember what the customer said before),
  // and the model is never told the support policy. Try it and see what trouble it gets into.
  let message = env.user.opening
  for (let turn = 0; turn < 10 && !env.user.done; turn++) {
    const res = await runAgent(message, env.tools)
    message = await env.user.respond(res.output)
  }
}
