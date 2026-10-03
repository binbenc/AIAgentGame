import { expect, test } from '@playwright/test'
import { T, fileOf, solutionFiles, useLocale } from './i18n'

const solution = solutionFiles(new URL('../../src/content/levels/l01-hello-model', import.meta.url).pathname)['llm.ts']

test('reference comparison: side by side → diff → take a hunk / replace (undoable) → layout restored on close', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await useLocale(page)
  await page.goto('/#/level/l01')
  await expect(page.locator('aside h1')).toBeVisible()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  const starter = await fileOf(page, 'llm.ts')
  expect(starter).not.toBe(solution)

  // 并排：左边自己的代码，右边参考；剧情面板自动收起
  await page.getByRole('button', { name: T('对照参考实现', 'Compare with reference') }).click()
  await expect(page.locator('aside h1')).toBeHidden()
  await expect(page.getByTitle(T('展开剧情与任务', 'Expand Story & task'))).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(2)
  await expect(page.getByText(T('我的实现 ·', 'Mine ·'))).toBeVisible()
  await page.screenshot({ path: 'test-results/compare-split.png' })

  // 整体替换为参考，再用 Cmd/Ctrl+Z 撤销
  await page.getByRole('button', { name: T('用参考替换', 'Use reference') }).click()
  await expect.poll(() => fileOf(page, 'llm.ts')).toBe(solution)
  await page.locator('.monaco-editor .view-lines').first().click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => fileOf(page, 'llm.ts')).toBe(starter)

  // 差异视图：逐块采用（点差异块旁边的箭头）
  await page.getByRole('button', { name: T('差异', 'Diff'), exact: true }).click()
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  await expect(page.locator('.monaco-diff-editor .line-insert').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/compare-diff.png' })
  const revert = page.locator('.monaco-diff-editor .codicon-arrow-right').first()
  await revert.hover({ force: true })
  await revert.click({ force: true })
  await expect.poll(() => fileOf(page, 'llm.ts')).not.toBe(starter)

  // 关闭对照：剧情面板恢复
  await page.getByRole('button', { name: T('✕ 关闭对照', '✕ Close comparison') }).click()
  await expect(page.locator('aside h1')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(1)
})

test('projects can be compared too: reference imports of level modules resolve', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await useLocale(page, { freeMode: true })
  await page.goto('/#/project/p05')
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: T('对照参考解法', 'Compare with reference') }).last().click()
  await expect(page.getByTitle(T('展开需求与任务', 'Expand Brief & tasks'))).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(2)
  const refPane = page.locator('.monaco-editor').nth(1)
  await expect(refPane.locator('.view-lines')).toContainText('import')
  // 参考工作区完整：参考代码里不应该出现“找不到模块”之类的类型错误
  await page.waitForTimeout(1500)
  await expect(refPane.locator('.squiggly-error')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/compare-project.png' })
  await page.getByTitle(T('展开需求与任务', 'Expand Brief & tasks')).click()
  await expect(page.locator('aside h1')).toBeVisible()
})
