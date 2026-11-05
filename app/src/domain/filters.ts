import type { ExpressionSpecification } from 'maplibre-gl'
import type { PriceType } from './place'
import { DISTANCE_PROPERTY, DISTANCE_THEMES, SEISMIC_PROPERTY, type DistanceTheme } from './themes'

export type FilterKey = 'price' | 'seismic' | DistanceTheme
/** Maximum accepted value per filter; a filter that is absent is off. */
export type Filters = Partial<Record<FilterKey, number>>

export interface FilterDef {
  key: FilterKey
  min: number
  /** The slider's last position means "no limit": the filter is off there. */
  max: number
  step: number
}

export const FILTER_DEFS: readonly FilterDef[] = [
  { key: 'price', min: 1000, max: 10000, step: 250 },
  { key: 'seismic', min: 1, max: 5, step: 1 },
  ...DISTANCE_THEMES.map((key): FilterDef => ({ key, min: 1000, max: 30000, step: 1000 })),
]

const DEF_BY_KEY = new Map(FILTER_DEFS.map((def) => [def.key, def]))

export function isFilterKey(value: string): value is FilterKey {
  return DEF_BY_KEY.has(value as FilterKey)
}

export const activeFilterKeys = (filters: Filters): FilterKey[] => FILTER_DEFS.map((def) => def.key).filter((key) => filters[key] !== undefined)

export function activeFilterCount(filters: Filters): number {
  return Object.keys(filters).length
}

/** Clamps to the slider's range and drops the filter when it sits at "no limit". */
export function withFilter(filters: Filters, key: FilterKey, value: number): Filters {
  const def = DEF_BY_KEY.get(key)
  const next = { ...filters }
  if (!def || value >= def.max) {
    delete next[key]
    return next
  }
  next[key] = Math.max(def.min, value)
  return next
}

const SEPARATOR = '.'

export function formatFilters(filters: Filters): string {
  return FILTER_DEFS.flatMap(({ key }) => (filters[key] === undefined ? [] : [`${key}-${filters[key]}`])).join(SEPARATOR)
}

export function parseFilters(text: string | null): Filters {
  if (!text) return {}
  return text.split(SEPARATOR).reduce<Filters>((filters, part) => {
    const [key, raw] = part.split('-')
    const value = Number(raw)
    if (!isFilterKey(key) || !Number.isFinite(value)) return filters
    return withFilter(filters, key, value)
  }, {})
}

function propertyFor(key: FilterKey, priceType: PriceType): string {
  if (key === 'price') return `p_${priceType}`
  if (key === 'seismic') return SEISMIC_PROPERTY
  return DISTANCE_PROPERTY[key]
}

/**
 * True for communes that satisfy every active filter. A commune with no value for an active filter
 * does not match: an unknown is never treated as a pass.
 */
export function matchExpression(filters: Filters, priceType: PriceType): ExpressionSpecification | null {
  const clauses = FILTER_DEFS.flatMap(({ key }) => {
    const limit = filters[key]
    if (limit === undefined) return []
    const property = propertyFor(key, priceType)
    return [['all', ['has', property], ['<=', ['get', property], limit]] as ExpressionSpecification]
  })
  return clauses.length === 0 ? null : (['all', ...clauses] as ExpressionSpecification)
}
