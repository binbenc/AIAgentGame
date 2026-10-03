/**
 * 命令行入口：用 .env 里配置的真实模型运行你在第 20 关组装的客服 Agent。
 *   npm run agent -- "我是 alice@example.com，最近那单到哪了？"
 *   npm run agent -- --user u-alice "X1 的滤网多久洗一次？"
 * 后端用的是游戏里的模拟业务系统（aq/content/shared）；接入真实系统时，替换 orders / kb 即可。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { NOVA_DOCS } from '../aq/content/shared/docs'
import { createNova } from '../aq/content/shared/nova'
import { useRealModel } from '../aq/node-runtime'
import { createSupportAgent } from '../src/app'
import { MemoryStore } from '../src/memory'
import { buildIndex } from '../src/rag'

// 读取 .env（不引入额外依赖）
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
  approve: async ({ tool, input }) => (await rl.question(`⚠️  Agent 请求执行 ${tool}(${JSON.stringify(input)})，批准吗？[y/N] `)).trim().toLowerCase() === 'y',
})

async function ask(text: string) {
  const r = await agent.handle(userId, text)
  console.log(`\n${r.reply}\n`)
  console.error(`  (${r.model} · $${r.costUsd.toFixed(5)}${r.handedOff ? ' · 已转人工' : ''})`)
}

if (message) {
  await ask(message)
  rl.close()
} else {
  console.log('Nova 客服 Agent（输入 exit 退出，-v 查看每一步）')
  for (;;) {
    const text = (await rl.question('你：')).trim()
    if (!text || text === 'exit') break
    await ask(text)
  }
  rl.close()
}
