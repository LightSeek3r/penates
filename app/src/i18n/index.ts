import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Lang } from '../state/urlState'
import en from './en.json'
import fr from './fr.json'

export const dictionaries = { fr, en } as const

export function initI18n(lang: Lang) {
  void i18next.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: lang,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  })
  return i18next
}

export function detectLang(languages: readonly string[]): Lang {
  return languages.some((tag) => tag.toLowerCase().startsWith('fr')) || languages.length === 0 ? 'fr' : 'en'
}
