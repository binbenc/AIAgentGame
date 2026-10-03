/**
 * Current locale, decided once at startup (switching language reloads the page; each sandbox worker is created per run).
 * - Sandbox worker: the host passes it in the worker name (`aq:en`)
 * - Node (tests, exported project): the AQ_LOCALE environment variable
 * - Browser main thread: the language the player picked (localStorage)
 * Content, data, assertion messages and mock replies all pick their language with L(zh, en) at module load time.
 */
export type Locale = 'en' | 'zh'

export const LOCALE_STORAGE_KEY = 'agent-quest:locale'

// The exported project rewrites this line to the language the player exported in
const DEFAULT_LOCALE: Locale = 'en'

const valid = (x: unknown): Locale | undefined => (x === 'en' || x === 'zh' ? x : undefined)

function detect(): Locale {
  const g = globalThis as {
    name?: unknown
    process?: { env?: Record<string, string | undefined> }
    localStorage?: { getItem(k: string): string | null }
    WorkerGlobalScope?: unknown
  }
  if (g.WorkerGlobalScope && typeof g.name === 'string') {
    const m = /^aq:(en|zh)$/.exec(g.name)
    if (m) return m[1] as Locale
  }
  const env = valid(g.process?.env?.AQ_LOCALE)
  if (env) return env
  try {
    const saved = valid(g.localStorage?.getItem(LOCALE_STORAGE_KEY))
    if (saved) return saved
  } catch {
    // localStorage can be unavailable (private mode, sandboxed iframes)
  }
  return DEFAULT_LOCALE
}

export const LOCALE: Locale = detect()

/** Pick the value for the current locale: L('中文', 'English') */
export function L<T>(zh: T, en: T): T {
  return LOCALE === 'en' ? en : zh
}
