import type { Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** e2e runs in one locale per invocation: AQ_LOCALE=zh npx playwright test (default en) */
export const LOCALE: 'en' | 'zh' = process.env.AQ_LOCALE === 'zh' ? 'zh' : 'en'
export const T = (zh: string, en: string) => (LOCALE === 'en' ? en : zh)

/** Call before the first page.goto */
export async function useLocale(page: Page, opts: { freeMode?: boolean } = {}) {
  await page.addInitScript(
    ([locale, free]) => {
      // Only on first load, so an in-app language switch survives the reload
      if (!localStorage.getItem('agent-quest:locale')) localStorage.setItem('agent-quest:locale', locale as string)
      if (free) localStorage.setItem('agent-quest:settings', JSON.stringify({ freeMode: true }))
    },
    [LOCALE, !!opts.freeMode] as const,
  )
}

export function readTree(dir: string, root = dir, out: Record<string, string> = {}) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) readTree(p, root, out)
    else out[relative(root, p)] = readFileSync(p, 'utf8')
  }
  return out
}

/** Reference solution files of a level/project dir in the current locale (solution.en/ overlays solution/) */
export function solutionFiles(dir: string): Record<string, string> {
  const zh = readTree(join(dir, 'solution'))
  return LOCALE === 'en' ? { ...zh, ...readTree(join(dir, 'solution.en')) } : zh
}

export function setFiles(page: Page, files: Record<string, string>) {
  return page.evaluate((fs) => {
    const s = (window as unknown as { __agentQuest: { useProgress: { getState(): { setFile(p: string, c: string): void } } } }).__agentQuest.useProgress.getState()
    for (const [p, c] of Object.entries(fs)) s.setFile(p, c)
  }, files)
}

export const fileOf = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __agentQuest: { useProgress: { getState(): { files: Record<string, string> } } } }).__agentQuest.useProgress.getState().files[p], path)
