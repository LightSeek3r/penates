import type { Lang } from '../state/urlState'

export function formatNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 }).format(value)
}

export function formatCompact(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB')

/** "2023-01/2025-12" as "janv. 2023 – déc. 2025", or null when the text is not in that shape. */
export function formatPeriod(period: string, lang: Lang): string | null {
  const match = /^(\d{4})-(\d{2})\/(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const month = new Intl.DateTimeFormat(locale(lang), { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const date = (year: string, monthNumber: string) => month.format(new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1)))
  return `${date(match[1], match[2])} – ${date(match[3], match[4])}`
}

export function formatChange(from: number, to: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format((to - from) / from)
}
