import type { Lang } from '../state/urlState'

const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB')

// Building an Intl formatter costs far more than using one (the legend alone formats a dozen numbers per render,
// the sheet frame a few per animation frame), so each locale and option set is built once.
const numberFormats = new Map<string, Intl.NumberFormat>()

export function numberFormat(lang: Lang, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(options)}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale(lang), options)
    numberFormats.set(key, format)
  }
  return format
}

const dateFormats = new Map<Lang, Intl.DateTimeFormat>()

function monthFormat(lang: Lang): Intl.DateTimeFormat {
  let format = dateFormats.get(lang)
  if (!format) {
    format = new Intl.DateTimeFormat(locale(lang), { month: 'short', year: 'numeric', timeZone: 'UTC' })
    dateFormats.set(lang, format)
  }
  return format
}

export function formatNumber(value: number, lang: Lang): string {
  return numberFormat(lang, { maximumFractionDigits: 0 }).format(value)
}

export function formatCompact(value: number, lang: Lang): string {
  return numberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** One decimal, e.g. "3.8" or "3,8". */
export function formatDecimal(value: number, lang: Lang): string {
  return numberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
}

/** "2023-01/2025-12" as "janv. 2023 – déc. 2025", or null when the text is not in that shape. */
export function formatPeriod(period: string, lang: Lang): string | null {
  const match = /^(\d{4})-(\d{2})\/(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const month = monthFormat(lang)
  const date = (year: string, monthNumber: string) => month.format(new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1)))
  return `${date(match[1], match[2])} – ${date(match[3], match[4])}`
}

export function formatChange(from: number, to: number, lang: Lang): string {
  return numberFormat(lang, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format((to - from) / from)
}

/** Megabytes with one decimal, e.g. "19.1 MB" or "19,1 Mo". */
export function formatMegabytes(bytes: number, lang: Lang): string {
  return `${formatDecimal(bytes / 1_048_576, lang)} ${lang === 'fr' ? 'Mo' : 'MB'}`
}
