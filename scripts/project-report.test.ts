// 运行：PROJECT=p01 npm run project-report —— 打印某个项目参考解法 / starter 在核心集上的逐题结果
import { it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { solutionThrough } from '../src/content/workspace'
import { projectById } from '../src/projects/registry'
import { runProject } from '../src/projects/runner'

it('report', async () => {
  const project = projectById(process.env.PROJECT ?? 'p01')!
  const library = solutionThrough(LEVELS, Infinity)
  for (const [name, files] of [['solution', project.solution], ['starter', project.starter]] as const) {
    const r = await runProject({ project, files: { ...library, ...files }, mode: 'mock' })
    process.stderr.write(`\n== ${project.id} ${name}: stars=${r.stars} passAt1=${r.summary.passAt1.toFixed(2)} tokens=${r.summary.totalTokens}/${project.tokenBudget}\n`)
    for (const x of r.results) {
      const logs = x.events.filter((e) => e.kind === 'log').map((e) => (e as { message: string }).message)
      process.stderr.write(`  [${x.status}] ${x.taskId} calls=${x.calls} tok=${x.inputTokens + x.outputTokens} ${x.reason.slice(0, 120)}\n${logs.map((l) => '      ' + l.slice(0, 140)).join('\n')}\n`)
    }
  }
})
