import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LOCALE, LOCALE_STORAGE_KEY, type Locale } from '../engine/locale'
import { flushSave } from '../state/progress'
import en from './en.json'
import zh from './zh.json'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: LOCALE,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

/**
 * Content (levels, projects, mock replies) picks its language once at module load, so switching reloads the page.
 * Pending saves are flushed first so no edits are lost.
 */
export async function switchLocale(locale: Locale) {
  if (locale === LOCALE) return
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Without localStorage the choice can't persist; nothing else to do
  }
  await flushSave()
  location.reload()
}

export default i18n
