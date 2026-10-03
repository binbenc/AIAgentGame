// 运行：npm run verify:project-export [PROJECT=p01] —— 用参考解法导出项目，在临时目录 npm install && npm test && tsc
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { solutionThrough } from '../src/content/workspace'
import { projectFileList } from '../src/projects/exportProject'
import { PROJECTS } from '../src/projects/registry'

const targets = PROJECTS.filter((p) => !process.env.PROJECT || p.id === process.env.PROJECT)

it.each(targets.map((p) => [p.id, p] as const))('%s 导出后可以安装、测试、类型检查', (_id, project) => {
  const dir = mkdtempSync(join(process.env.EXPORT_DIR ?? tmpdir(), `aq-${project.id}-`))
  const files = projectFileList(project, { files: { ...solutionThrough(LEVELS, Infinity), ...project.solution }, borrowed: [] })
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), c)
  }
  process.stderr.write(`导出到 ${dir}\n`)
  execSync('npm install --no-audit --no-fund', { cwd: dir, stdio: 'inherit' })
  execSync('npx vitest run tests', { cwd: dir, stdio: 'inherit' })
  execSync('npx tsc --noEmit', { cwd: dir, stdio: 'inherit' })
  expect(true).toBe(true)
}, 600_000)
