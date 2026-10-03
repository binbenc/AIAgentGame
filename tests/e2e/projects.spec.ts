import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { T, setFiles, solutionFiles, useLocale } from './i18n'

const ROOT = new URL('../../src/', import.meta.url).pathname
const RUN = T('运行核心集', 'Run core set')

test('project P1: naive starter fails → reference solution earns 3 stars → history → export', async ({ page }) => {
  await useLocale(page, { freeMode: true })
  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: T('实战项目', 'Projects'), exact: true })).toBeVisible()
  await page.goto('/#/project/p01')
  await expect(page.getByRole('button', { name: RUN })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: RUN }).click()
  await expect(page.getByText(/pass@1 0%/)).toBeVisible({ timeout: 30_000 })

  const files = Object.fromEntries(Object.entries(solutionFiles(join(ROOT, 'projects/p01-helpdesk'))).map(([p, c]) => [`projects/helpdesk/${p}`, c]))
  await setFiles(page, files)
  await page.getByRole('button', { name: RUN }).click()
  await expect(page.getByText(/pass@1 100%/)).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: 'test-results/project-p01.png' })

  await page.getByRole('button', { name: new RegExp(`${T('历史', 'History')} 2`) }).click()
  await expect(page.getByText('100%').first()).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: T('导出项目', 'Export project') }).click()
  expect((await download).suggestedFilename()).toBe('helpdesk-agent.zip')
})

test('in the browser sandbox, every project reference solution passes the core set', async ({ page }) => {
  test.setTimeout(240_000)
  await useLocale(page, { freeMode: true })
  const dirs = readdirSync(join(ROOT, 'projects')).filter((d) => /^p\d\d-/.test(d)).sort()
  for (const dir of dirs) {
    const id = dir.slice(0, 3)
    const slug = readFileSync(join(ROOT, 'projects', dir, 'index.ts'), 'utf8').match(/projects\/([\w-]+)\//)![1]
    const files = Object.fromEntries(Object.entries(solutionFiles(join(ROOT, 'projects', dir))).map(([p, c]) => [`projects/${slug}/${p}`, c]))
    await page.goto(`/#/project/${id}`)
    await expect(page.getByRole('button', { name: RUN })).toBeVisible({ timeout: 20_000 })
    await setFiles(page, files)
    await page.getByRole('button', { name: RUN }).click()
    await expect(page.getByText(/pass@1 100%/), `${id} core set should fully pass`).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `test-results/project-${id}.png` })
  }
})
