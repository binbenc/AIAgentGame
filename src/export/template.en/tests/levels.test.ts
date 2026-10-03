/**
 * Regression tests: checks the code under src/ with the same grading scenarios you passed in the game.
 * Uses the deterministic mock model by default (free, stable, CI-friendly); with AQ_MODE=real it uses the real model configured in .env.
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
  it(`all scenarios pass (${mode})`, async () => {
    const r = await runSuite({ suite, files: readTree(SRC), mode, realProvider: providerFromEnv })
    const failed = r.results.filter((x) => x.status === 'failed' || x.status === 'error').map((x) => `[${x.id}] ${x.message}`)
    expect(failed.join('\n')).toBe('')
  })
})
