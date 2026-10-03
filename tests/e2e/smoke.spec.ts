import { expect, test } from '@playwright/test'
import { T, setFiles, solutionFiles, useLocale } from './i18n'

const L01 = new URL('../../src/content/levels/l01-hello-model', import.meta.url).pathname

test('level 1: starter fails → reference solution earns 3 stars → progress survives a reload', async ({ page }) => {
  await useLocale(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: T('生产级 AI Agent', 'production-grade AI agent') })).toBeVisible()
  await page.screenshot({ path: 'test-results/home.png' })
  await page.getByRole('link', { name: T('开始入职', 'Start your first day') }).click()
  await expect(page.locator('aside h1')).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: T('运行判题', 'Run tests') }).click()
  await expect(page.getByText(T('还没通过', 'Not passing yet'))).toBeVisible({ timeout: 20_000 })

  await setFiles(page, solutionFiles(L01))
  await page.getByRole('button', { name: T('运行判题', 'Run tests') }).click()
  await expect(page.getByText(T('通关！', 'Level cleared!'))).toBeVisible({ timeout: 20_000 })
  await page.getByText(T('模型 →', 'Model →')).first().click()
  await page.screenshot({ path: 'test-results/level1-passed.png' })

  await page.waitForTimeout(500)
  await page.goto('/#/map')
  await expect(page.getByText(T('已通关', 'Passed') + ' 1 /')).toBeVisible()
  await page.screenshot({ path: 'test-results/map.png' })
})

test('language switch: the top-bar button reloads into the other language and keeps progress', async ({ page }) => {
  await useLocale(page)
  await page.goto('/#/level/l01')
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  await setFiles(page, { 'llm.ts': '// my edit\n' })
  await page.getByRole('button', { name: T('EN', '中文'), exact: true }).click()
  // After the reload the UI is in the other language
  await expect(page.getByRole('button', { name: T('Run tests', '运行判题') })).toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => localStorage.getItem('agent-quest:locale'))).toBe(T('en', 'zh'))
  const kept = await page.evaluate(() => (window as unknown as { __agentQuest: { useProgress: { getState(): { files: Record<string, string> } } } }).__agentQuest.useProgress.getState().files['llm.ts'])
  expect(kept).toBe('// my edit\n')
})
