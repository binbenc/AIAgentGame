import { expect, test } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { T, setFiles, solutionFiles, useLocale } from './i18n'

const LEVELS_DIR = new URL('../../src/content/levels/', import.meta.url).pathname
const levelDirs = readdirSync(LEVELS_DIR).filter((d) => /^l\d\d-/.test(d)).sort()

test('in the browser sandbox, every level reference solution earns 3 stars', async ({ page }) => {
  test.setTimeout(300_000)
  await useLocale(page, { freeMode: true })
  await page.goto('/#/map')
  const workspace: Record<string, string> = {}
  for (const dir of levelDirs) {
    Object.assign(workspace, solutionFiles(join(LEVELS_DIR, dir)))
    const id = dir.slice(0, 3)
    await page.goto(`/#/level/${id}`)
    await expect(page.getByRole('button', { name: T('运行判题', 'Run tests') })).toBeVisible({ timeout: 20_000 })
    await setFiles(page, workspace)
    await page.getByRole('button', { name: T('运行判题', 'Run tests') }).click()
    await expect(page.getByText(T('通关！', 'Level cleared!')), `${id} should pass`).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(`[aria-label="${T('3 星', '3 stars')}"]`).nth(1), `${id} should earn 3 stars`).toBeVisible()
    if (id === 'l14' || id === 'l20') await page.screenshot({ path: `test-results/${id}.png` })
  }
  await page.goto('/#/graduate')
  await expect(page.getByText(T('🎓 毕业了！', '🎓 You graduated!'))).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /my-nova-agent.zip/ }).click()
  expect((await download).suggestedFilename()).toBe('my-nova-agent.zip')
  await page.screenshot({ path: 'test-results/graduate.png' })
})
