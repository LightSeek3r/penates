import type { Lang } from '../state/urlState'

export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(value)
}

export function formatCompact(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
