// 运行：npm run verify:export —— 用全部参考实现生成导出工程，然后在临时目录里 npm install && npm test
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { LEVELS } from '../src/content/levels'
import { solutionThrough } from '../src/content/workspace'
import { exportFileList } from '../src/export/buildZip'

it('导出的工程可以安装并通过全部测试', () => {
  const dir = mkdtempSync(join(process.env.EXPORT_DIR ?? tmpdir(), 'aq-export-'))
  const levels = Object.fromEntries(LEVELS.map((l) => [l.id, { stars: 3, passed: true, realBadge: false, attempts: 1, hintsShown: 0 }]))
  const files = exportFileList({ files: solutionThrough(LEVELS, Infinity), levels, borrowed: [] })
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), c)
  }
  process.stderr.write(`导出到 ${dir}\n`)
  execSync('npm install --no-audit --no-fund', { cwd: dir, stdio: 'inherit' })
  execSync('npx vitest run', { cwd: dir, stdio: 'inherit' })
  execSync('npx tsc --noEmit', { cwd: dir, stdio: 'inherit' })
  expect(true).toBe(true)
}, 600_000)
