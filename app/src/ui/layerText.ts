import type { useTranslation } from 'react-i18next'
import type { FilterValue } from '../domain/filters'
import { type LayerDef, displayValue } from '../domain/layers'
import type { Lang } from '../state/urlState'
import { formatCompact, formatDecimal, formatNumber, numberFormat } from './format'

export type Translate = ReturnType<typeof useTranslation>['t']

/** Wording of indicators, generated from the catalogue: legend rows, filter read-outs and details rows. */

const bare = (def: LayerDef, value: number, lang: Lang) => numberFormat(lang, { maximumFractionDigits: 1 }).format(displayValue(def, value))

export const withUnit = (t: Translate, def: LayerDef, text: string): string => t(`units.${def.unit}`, { value: text })

/** A value with its unit, at the precision the details panel uses ("3,8 km", "12,5 €/m²/mois"). */
export function formatLayerValue(t: Translate, def: LayerDef, value: number, lang: Lang): string {
  if (def.scale.kind === 'classes') return t('units.class', { value, name: className(t, def, value) })
  const shown = displayValue(def, value)
  return withUnit(t, def, def.decimals === 1 ? formatDecimal(shown, lang) : formatNumber(shown, lang))
}

export const className = (t: Translate, def: LayerDef, code: number): string => t(`ind.${def.id}.classes.${code}`)

export interface LegendRow {
  key: string
  color: string
  label: string
  short: string
}

export function legendRows(t: Translate, def: LayerDef, colours: readonly string[], lang: Lang): LegendRow[] {
  const { scale } = def
  if (scale.kind === 'classes') {
    return scale.values.map((code, index) => ({
      key: String(code),
      color: colours[index],
      label: t(`ind.${def.id}.classLabel`, { value: code, name: className(t, def, code) }),
      short: String(code),
    }))
  }
  const { breaks } = scale
  const last = breaks.length
  const unit = (text: string) => (def.rowUnit === false ? text : withUnit(t, def, text))
  const number = (value: number) => bare(def, value, lang)
  // Phone strip: price keeps its compact "1,5 k"; other quantities stay readable as plain numbers up to 10,000.
  const compact = (value: number) => (def.rowUnit === false || displayValue(def, value) >= 10_000 ? formatCompact(displayValue(def, value), lang) : number(value))
  return colours.map((color, index) => {
    const from = index === 0 ? null : breaks[index - 1]
    const to = index === last ? null : breaks[index]
    let label: string
    if (from === null && to !== null) label = scale.integer && to === 1 ? unit('0') : t('legend.under', { value: unit(number(to)) })
    else if (to === null && from !== null) label = t('legend.over', { value: unit(number(from)) })
    else if (from !== null && to !== null && scale.integer && to - 1 === from) label = unit(number(from))
    else label = t('legend.range', { from: number(from ?? 0), to: unit(number(scale.integer ? (to ?? 0) - 1 : (to ?? 0))) })
    const short = from === null ? (scale.integer && to === 1 ? '0' : `<${compact(to ?? 0)}`) : to === null ? `${compact(from)}+` : compact(from)
    return { key: color, color, label, short }
  })
}

/** Read-out next to a filter control, e.g. "jusqu'à 10 km", "au moins 2 000 h/an", "200 à 800 m". */
export function filterValueText(t: Translate, def: LayerDef, value: FilterValue | undefined, lang: Lang): string {
  if (value === undefined) return t('filters.any')
  const spec = def.filter
  if (!spec) return ''
  if (spec.kind === 'classes') {
    const codes = Array.isArray(value) ? value : [value]
    return codes.map((code) => className(t, def, code)).join(', ')
  }
  const text = (bound: number) => withUnit(t, def, formatNumber(displayValue(def, bound), lang))
  if (spec.kind === 'range' && Array.isArray(value)) {
    const [from, to] = value
    if (from <= spec.min) return t('filters.upTo', { value: text(to) })
    if (to >= spec.max) return t('filters.from', { value: text(from) })
    return t('filters.between', { from: formatNumber(displayValue(def, from), lang), to: text(to) })
  }
  if (typeof value !== 'number') return ''
  if (spec.kind === 'min') return t('filters.atLeast', { value: text(value) })
  if (def.scale.kind === 'classes') return t('filters.atMost', { value: t(`ind.${def.id}.short`, { value }) })
  return t('filters.upTo', { value: text(value) })
}
