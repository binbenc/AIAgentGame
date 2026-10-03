import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const LEVELS_DIR = new URL('../../src/content/levels/', import.meta.url).pathname
const levelDirs = readdirSync(LEVELS_DIR).filter((d) => /^l\d\d-/.test(d)).sort()

function readTree(dir: string, root = dir, out: Record<string, string> = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) readTree(p, root, out)
    else out[relative(root, p)] = readFileSync(p, 'utf8')
  }
  return out
}

test('浏览器沙箱里，所有关卡的参考实现都能三星通关', async ({ page }) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => localStorage.setItem('agent-quest:settings', JSON.stringify({ freeMode: true })))
  await page.goto('/#/map')
  const workspace: Record<string, string> = {}
  for (const dir of levelDirs) {
    Object.assign(workspace, readTree(join(LEVELS_DIR, dir, 'solution')))
    const id = dir.slice(0, 3)
    await page.goto(`/#/level/${id}`)
    await expect(page.getByRole('button', { name: /运行判题/ })).toBeVisible({ timeout: 20_000 })
    await page.evaluate((files) => {
      const s = (window as unknown as { __agentQuest: { useProgress: { getState(): { setFile(p: string, c: string): void } } } }).__agentQuest.useProgress.getState()
      for (const [p, c] of Object.entries(files)) s.setFile(p, c)
    }, workspace)
    await page.getByRole('button', { name: /运行判题/ }).click()
    await expect(page.getByText('通关！'), `${id} 应该通关`).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[aria-label="3 星"]').nth(1), `${id} 应该三星`).toBeVisible()
    if (id === 'l14' || id === 'l20') await page.screenshot({ path: `test-results/${id}.png` })
  }
  await page.goto('/#/graduate')
  await expect(page.getByText('🎓 毕业了！')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载 my-nova-agent.zip/ }).click()
  expect((await download).suggestedFilename()).toBe('my-nova-agent.zip')
  await page.screenshot({ path: 'test-results/graduate.png' })
})
