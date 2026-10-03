/**
 * Command-line entry point: runs the support agent you assembled in Level 20 against the real model configured in .env.
 *   npm run agent -- "I'm alice@example.com, where's my latest order?"
 *   npm run agent -- --user u-alice "How often should I clean the X1 filter?"
 * The backend is the game's mock business system (aq/content/shared); to connect real systems, swap out orders / kb.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { NOVA_DOCS } from '../aq/content/shared/docs'
import { createNova } from '../aq/content/shared/nova'
import { useRealModel } from '../aq/node-runtime'
import { createSupportAgent } from '../src/app'
import { MemoryStore } from '../src/memory'
import { buildIndex } from '../src/rag'

// Load .env (no extra dependencies)
if (existsSync('.env'))
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }

const args = process.argv.slice(2)
const userIdx = args.indexOf('--user')
const userId = userIdx >= 0 ? args.splice(userIdx, 2)[1] : 'u-cli'
const verbose = args.includes('-v') ? (args.splice(args.indexOf('-v'), 1), true) : false
const message = args.join(' ').trim()

try {
  useRealModel({
  onEvent: (e) => {
    if (!verbose) return
    if (e.kind === 'llm') console.error(`  🧠 ${e.response?.model ?? ''} ${e.durationMs}ms ${e.error ?? e.response?.stop_reason}`)
    if (e.kind === 'tool') console.error(`  🔧 ${e.name}(${JSON.stringify(e.input)})${e.error ? ' ✗ ' + e.error : ''}`)
    if (e.kind === 'log') console.error(`  📝 ${e.message}`)
  },
  })
} catch (e) {
  console.error(`❌ ${(e as Error).message}`)
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const agent = createSupportAgent({
  orders: createNova(),
  kb: buildIndex(NOVA_DOCS),
  memory: new MemoryStore(),
  approve: async ({ tool, input }) => (await rl.question(`⚠️  The agent wants to run ${tool}(${JSON.stringify(input)}). Approve? [y/N] `)).trim().toLowerCase() === 'y',
})

async function ask(text: string) {
  const r = await agent.handle(userId, text)
  console.log(`\n${r.reply}\n`)
  console.error(`  (${r.model} · $${r.costUsd.toFixed(5)}${r.handedOff ? ' · handed off to a human' : ''})`)
}

if (message) {
  await ask(message)
  rl.close()
} else {
  console.log('Nova support agent (type exit to quit, -v to see each step)')
  for (;;) {
    const text = (await rl.question('You: ')).trim()
    if (!text || text === 'exit') break
    await ask(text)
  }
  rl.close()
}
