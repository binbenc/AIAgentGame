import { describe, expect, it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { baselineBefore, prepareWorkspace, solutionThrough } from '../src/content/workspace'
import { runSuite } from '../src/engine/judge/runner'

function report(r: Awaited<ReturnType<typeof runSuite>>): string {
  return r.results
    .filter((x) => x.status !== 'passed')
    .map((x) => `[${x.status}] ${x.id}: ${x.message}`)
    .join('\n')
}

describe.each(LEVELS.map((l) => [l.id, l] as const))('关卡 %s', (_id, level) => {
  it('参考实现能三星通关', async () => {
    const r = await runSuite({ suite: level.suite, files: solutionThrough(LEVELS, level.number), mode: 'mock' })
    expect(report(r)).toBe('')
    expect(r.passed).toBe(true)
    expect({ stars: r.stars, totals: r.totals }).toEqual({ stars: 3, totals: r.totals })
  })

  it('初始代码不能通关', async () => {
    const { files } = prepareWorkspace(baselineBefore(LEVELS, level.number), level)
    const r = await runSuite({ suite: level.suite, files, mode: 'mock' })
    expect(r.passed).toBe(false)
  })

  it('每个文件声明都有效', () => {
    expect(level.files.length).toBeGreaterThan(0)
    const base = baselineBefore(LEVELS, level.number)
    for (const f of level.files) expect(f.starter !== undefined || f.path in base, `${f.path} 既没有 starter 也不在之前的工作区里`).toBe(true)
    for (const f of level.files) expect(f.path in level.solution, `${f.path} 缺少参考实现`).toBe(true)
  })
})

describe('回归', () => {
  it('最终工作区通过所有关卡', async () => {
    const files = solutionThrough(LEVELS, Infinity)
    for (const level of LEVELS) {
      const r = await runSuite({ suite: level.suite, files, mode: 'mock' })
      expect(report(r), level.id).toBe('')
    }
  })
})
