// 运行：npx vitest run --dir scripts  —— 打印每关参考实现的消耗，用来校准星级预算
import { it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { solutionThrough } from '../src/content/workspace'
import { runSuite } from '../src/engine/judge/runner'

it('print budgets', async () => {
  for (const l of LEVELS) {
    const r = await runSuite({ suite: l.suite, files: solutionThrough(LEVELS, l.number), mode: 'mock' })
    process.stderr.write(`${l.id} passed=${r.passed} calls=${r.totals.calls}/${l.suite.budgets.calls} tokens=${r.totals.tokens}/${l.suite.budgets.tokens}\n`)
  }
})
