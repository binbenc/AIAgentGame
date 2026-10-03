import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const solution = readFileSync(new URL('../../src/content/levels/l01-hello-model/solution/llm.ts', import.meta.url), 'utf8')

test('第 1 关：初始代码失败 → 写入参考实现 → 三星通关 → 刷新后进度仍在', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /生产级 AI Agent/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/home.png' })
  await page.getByRole('link', { name: '开始入职' }).click()
  await expect(page.getByRole('heading', { name: '你好，模型' })).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: /运行判题/ }).click()
  await expect(page.getByText('还没通过')).toBeVisible({ timeout: 20_000 })

  await page.evaluate((code) => {
    const w = window as unknown as { __agentQuest: { useProgress: { getState(): { setFile(p: string, c: string): void } } } }
    w.__agentQuest.useProgress.getState().setFile('llm.ts', code)
  }, solution)
  await page.getByRole('button', { name: /运行判题/ }).click()
  await expect(page.getByText('通关！')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /截断检测/ }).click()
  await page.getByText(/模型 →/).first().click()
  await page.screenshot({ path: 'test-results/level1-passed.png' })

  await page.waitForTimeout(500)
  await page.goto('/#/map')
  await expect(page.getByText('已通关 1 /')).toBeVisible()
  await page.screenshot({ path: 'test-results/map.png' })
})
