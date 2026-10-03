/**
 * 回归测试：用你在游戏里通关时的同一套判题场景，检验 src/ 下的代码。
 * 默认使用确定性的模拟模型（免费、稳定，适合 CI）；AQ_MODE=real 时改用 .env 里配置的真实模型。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSuite } from '../aq/engine/judge/runner'
import type { LevelSuite } from '../aq/engine/judge/types'
import { providerFromEnv } from '../aq/node-runtime'

const SRC = new URL('../src/', import.meta.url).pathname

function readTree(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) readTree(p, out)
    else if (p.endsWith('.ts')) out[relative(SRC, p).split('\\').join('/')] = readFileSync(p, 'utf8')
  }
  return out
}

const suites = import.meta.glob<{ suite: LevelSuite }>('../aq/content/levels/*/suite.ts', { eager: true })
const mode = process.env.AQ_MODE === 'real' ? 'real' : 'mock'

describe.each(Object.entries(suites).map(([path, m]) => [path.split('/').at(-2)!, m.suite] as const))('%s', (_name, suite) => {
  it(`全部场景通过（${mode}）`, async () => {
    const r = await runSuite({ suite, files: readTree(SRC), mode, realProvider: providerFromEnv })
    const failed = r.results.filter((x) => x.status === 'failed' || x.status === 'error').map((x) => `[${x.id}] ${x.message}`)
    expect(failed.join('\n')).toBe('')
  })
})
