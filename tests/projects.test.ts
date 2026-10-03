import { describe, expect, it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { solutionThrough } from '../src/content/workspace'
import { PROJECTS } from '../src/projects/registry'
import { runProject } from '../src/projects/runner'

const library = solutionThrough(LEVELS, Infinity)

function failures(r: Awaited<ReturnType<typeof runProject>>) {
  return r.results.filter((x) => x.status !== 'passed').map((x) => `[${x.status}] ${x.taskId}: ${x.reason}`).join('\n')
}

describe.each(PROJECTS.map((p) => [p.id, p] as const))('项目 %s', (_id, project) => {
  it('参考解法在核心集上三星通过', async () => {
    const r = await runProject({ project, files: { ...library, ...project.solution }, mode: 'mock' })
    expect(failures(r)).toBe('')
    expect({ stars: r.stars, tokens: r.summary.totalTokens, budget: project.tokenBudget }).toMatchObject({ stars: 3 })
  })

  it('初始代码达不到及格线', async () => {
    const r = await runProject({ project, files: { ...library, ...project.starter }, mode: 'mock' })
    expect(r.stars).toBe(0)
  })

  it('任务与文件声明有效', () => {
    expect(project.entry in project.starter).toBe(true)
    expect(project.entry in project.solution).toBe(true)
    expect(project.tasks.filter((t) => t.core).length).toBeGreaterThanOrEqual(5)
    expect(new Set(project.tasks.map((t) => t.id)).size).toBe(project.tasks.length)
  })
})
