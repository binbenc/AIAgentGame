import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const solution = readFileSync(new URL('../../src/content/levels/l01-hello-model/solution/llm.ts', import.meta.url), 'utf8')

const fileOf = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __agentQuest: { useProgress: { getState(): { files: Record<string, string> } } } }).__agentQuest.useProgress.getState().files[p], path)

test('参考实现对照：并排 → 差异 → 逐块采用 / 整体替换（可撤销）→ 关闭后恢复布局', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/level/l01')
  await expect(page.getByRole('heading', { name: '你好，模型' })).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  const starter = await fileOf(page, 'llm.ts')
  expect(starter).not.toBe(solution)

  // 并排：左边自己的代码，右边参考；剧情面板自动收起
  await page.getByRole('button', { name: '对照参考实现' }).click()
  await expect(page.getByRole('heading', { name: '你好，模型' })).toBeHidden()
  await expect(page.getByTitle('展开剧情与任务')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(2)
  await expect(page.getByText('我的实现 ·')).toBeVisible()
  await page.screenshot({ path: 'test-results/compare-split.png' })

  // 整体替换为参考，再用 Cmd/Ctrl+Z 撤销
  await page.getByRole('button', { name: '用参考替换' }).click()
  await expect.poll(() => fileOf(page, 'llm.ts')).toBe(solution)
  await page.locator('.monaco-editor .view-lines').first().click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => fileOf(page, 'llm.ts')).toBe(starter)

  // 差异视图：逐块采用（点差异块旁边的箭头）
  await page.getByRole('button', { name: '差异', exact: true }).click()
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  await expect(page.locator('.monaco-diff-editor .line-insert').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/compare-diff.png' })
  const revert = page.locator('.monaco-diff-editor .codicon-arrow-right').first()
  await revert.hover({ force: true })
  await revert.click({ force: true })
  await expect.poll(() => fileOf(page, 'llm.ts')).not.toBe(starter)

  // 关闭对照：剧情面板恢复
  await page.getByRole('button', { name: '✕ 关闭对照' }).click()
  await expect(page.getByRole('heading', { name: '你好，模型' })).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(1)
})

test('实战项目也能对照：参考解法的多个文件可切换，参考代码里 import 的关卡模块能解析', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.addInitScript(() => localStorage.setItem('agent-quest:settings', JSON.stringify({ freeMode: true })))
  await page.goto('/#/project/p05')
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '对照参考解法' }).last().click()
  await expect(page.getByTitle('展开需求与任务')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(2)
  const refPane = page.locator('.monaco-editor').nth(1)
  await expect(refPane.locator('.view-lines')).toContainText('import')
  // 参考工作区完整：参考代码里不应该出现“找不到模块”之类的类型错误
  await page.waitForTimeout(1500)
  await expect(refPane.locator('.squiggly-error')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/compare-project.png' })
  await page.getByTitle('展开需求与任务').click()
  await expect(page.getByRole('heading', { name: '零售客服' })).toBeVisible()
})
