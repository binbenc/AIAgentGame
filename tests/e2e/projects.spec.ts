import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../src/', import.meta.url).pathname

function readTree(dir: string, root = dir, out: Record<string, string> = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) readTree(p, root, out)
    else out[relative(root, p)] = readFileSync(p, 'utf8')
  }
  return out
}

test('实战项目 P1：朴素实现不及格 → 参考解法三星 → 历史记录 → 导出', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agent-quest:settings', JSON.stringify({ freeMode: true })))
  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: '实战项目' })).toBeVisible()
  await page.getByText('帮助中心问答').click()
  await expect(page.getByRole('button', { name: /运行核心集/ })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: /运行核心集/ }).click()
  await expect(page.getByText(/pass@1 0%/)).toBeVisible({ timeout: 30_000 })

  const solution = readFileSync(join(ROOT, 'projects/p01-helpdesk/solution/main.ts'), 'utf8')
  await page.evaluate((code) => {
    const s = (window as unknown as { __agentQuest: { useProgress: { getState(): { setFile(p: string, c: string): void } } } }).__agentQuest.useProgress.getState()
    s.setFile('projects/helpdesk/main.ts', code)
  }, solution)
  void readTree
  await page.getByRole('button', { name: /运行核心集/ }).click()
  await expect(page.getByText(/pass@1 100%/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /新旧文档冲突/ }).click()
  await page.screenshot({ path: 'test-results/project-p01.png' })

  await page.getByRole('button', { name: /历史 2/ }).click()
  await expect(page.getByText('100%').first()).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出项目/ }).click()
  expect((await download).suggestedFilename()).toBe('helpdesk-agent.zip')
})

test('浏览器沙箱里，所有项目的参考解法都能三星通过核心集', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => localStorage.setItem('agent-quest:settings', JSON.stringify({ freeMode: true })))
  const dirs = readdirSync(join(ROOT, 'projects')).filter((d) => /^p\d\d-/.test(d)).sort()
  for (const dir of dirs) {
    const id = dir.slice(0, 3)
    const slug = readFileSync(join(ROOT, 'projects', dir, 'index.ts'), 'utf8').match(/projects\/([\w-]+)\//)![1]
    const files = Object.fromEntries(Object.entries(readTree(join(ROOT, 'projects', dir, 'solution'))).map(([p, c]) => [`projects/${slug}/${p}`, c]))
    await page.goto(`/#/project/${id}`)
    await expect(page.getByRole('button', { name: /运行核心集/ })).toBeVisible({ timeout: 20_000 })
    await page.evaluate((fs) => {
      const s = (window as unknown as { __agentQuest: { useProgress: { getState(): { setFile(p: string, c: string): void } } } }).__agentQuest.useProgress.getState()
      for (const [p, c] of Object.entries(fs)) s.setFile(p, c)
    }, files)
    await page.getByRole('button', { name: /运行核心集/ }).click()
    await expect(page.getByText(/pass@1 100%/), `${id} 核心集应全部通过`).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `test-results/project-${id}.png` })
  }
})
