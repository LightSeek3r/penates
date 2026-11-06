import type { ExpressionSpecification } from 'maplibre-gl'
import { LAYERS, type ClassFilter, type FilterKey, type LayerDef, type SliderFilter, propertyOf } from './layers'
import type { PriceType } from './place'

export type { FilterKey } from './layers'

/** A bound for `max` / `min`, `[from, to]` for `range`, the accepted class codes for `classes`. */
export type FilterValue = number | readonly [number, number] | readonly number[]
/** Active filters only; a filter that is absent is off. */
export type Filters = Partial<Record<FilterKey, FilterValue>>

export interface FilterDef extends LayerDef {
  readonly filter: SliderFilter | ClassFilter
}

export const isFilterable = (def: LayerDef): def is FilterDef => def.filter !== undefined

export const FILTER_DEFS: readonly FilterDef[] = LAYERS.filter(isFilterable)

const DEF_BY_KEY: ReadonlyMap<string, FilterDef> = new Map(FILTER_DEFS.map((def) => [def.id, def]))

export function filterDef(key: string): FilterDef | undefined {
  return DEF_BY_KEY.get(key)
}

export function isFilterKey(value: string): value is FilterKey {
  return DEF_BY_KEY.has(value)
}

export const activeFilterKeys = (filters: Filters): FilterKey[] => FILTER_DEFS.flatMap((def) => (filters[def.id as FilterKey] === undefined ? [] : [def.id as FilterKey]))

export function activeFilterCount(filters: Filters): number {
  return Object.keys(filters).length
}

const clamp = (value: number, { min, max }: SliderFilter) => Math.min(max, Math.max(min, value))

function classCodes(def: FilterDef): readonly number[] {
  return def.scale.kind === 'classes' ? def.scale.values : []
}

/**
 * The value a filter keeps once clamped to its control, or undefined when that value means "no limit": a maximum at
 * the slider's end, a minimum at its start, a range spanning the whole slider, no class or every class.
 */
export function normaliseFilter(def: FilterDef, value: FilterValue): FilterValue | undefined {
  const spec = def.filter
  if (spec.kind === 'classes') {
    const codes = classCodes(def)
    const picked = codes.filter((code) => (Array.isArray(value) ? value.includes(code) : value === code))
    return picked.length === 0 || picked.length === codes.length ? undefined : picked
  }
  if (spec.kind === 'range') {
    if (!Array.isArray(value) || value.length !== 2) return undefined
    const [from, to] = [clamp(value[0], spec), clamp(value[1], spec)].sort((a, b) => a - b)
    return from <= spec.min && to >= spec.max ? undefined : [from, to]
  }
  if (typeof value !== 'number') return undefined
  if (spec.kind === 'max') return value >= spec.max ? undefined : Math.max(spec.min, value)
  return value <= spec.min ? undefined : Math.min(spec.max, value)
}

/** Sets one filter, clamping it to its control and dropping it when it sits at "no limit". */
export function withFilter(filters: Filters, key: FilterKey, value: FilterValue): Filters {
  const def = DEF_BY_KEY.get(key)
  const next = { ...filters }
  const kept = def ? normaliseFilter(def, value) : undefined
  if (kept === undefined) delete next[key]
  else next[key] = kept
  return next
}

export function withoutFilters(filters: Filters, drop: (def: FilterDef) => boolean): Filters {
  const next = { ...filters }
  for (const def of FILTER_DEFS) if (drop(def)) delete next[def.id as FilterKey]
  return next
}

// URL text: `<key>-<value>` joined by `.`, e.g. `price-3500.seismic-3.altitude-200_800`. Slider bounds are whole
// numbers (see SliderFilter), so values never contain the separator.
const SEPARATOR = '.'
const LIST = '_'

function formatValue(value: FilterValue): string {
  return typeof value === 'number' ? String(value) : value.join(LIST)
}

function parseValue(def: FilterDef, raw: string | undefined): FilterValue | undefined {
  if (raw === undefined || raw === '') return undefined
  const numbers = raw.split(LIST).map(Number)
  if (numbers.some((value) => !Number.isFinite(value))) return undefined
  if (def.filter.kind === 'classes') return numbers
  if (def.filter.kind === 'range') return numbers.length === 2 ? [numbers[0], numbers[1]] : undefined
  return numbers.length === 1 ? numbers[0] : undefined
}

export function formatFilters(filters: Filters, defs: readonly FilterDef[] = FILTER_DEFS): string {
  return defs
    .flatMap((def) => {
      const value = filters[def.id as FilterKey]
      return value === undefined ? [] : [`${def.id}-${formatValue(value)}`]
    })
    .join(SEPARATOR)
}

export function parseFilters(text: string | null, defs: readonly FilterDef[] = FILTER_DEFS): Filters {
  if (!text) return {}
  const byKey = new Map(defs.map((def) => [def.id, def]))
  return text.split(SEPARATOR).reduce<Filters>((filters, part) => {
    const [key, raw] = part.split('-')
    const def = byKey.get(key)
    const value = def ? parseValue(def, raw) : undefined
    const kept = def && value !== undefined ? normaliseFilter(def, value) : undefined
    return kept === undefined ? filters : { ...filters, [key]: kept }
  }, {})
}

/** One commune-side condition per active filter; `has` first, so an unknown value never passes. */
export function filterClause(def: FilterDef, value: FilterValue, priceType: PriceType): ExpressionSpecification {
  const property = propertyOf(def, priceType)
  const get: ExpressionSpecification = ['get', property]
  const spec = def.filter
  const conditions: ExpressionSpecification[] = []
  if (spec.kind === 'classes' && Array.isArray(value)) conditions.push(['in', get, ['literal', [...value]]])
  else if (spec.kind === 'range' && Array.isArray(value)) {
    if (value[0] > spec.min) conditions.push(['>=', get, value[0]])
    if (value[1] < spec.max) conditions.push(['<=', get, value[1]])
  } else if (typeof value === 'number') conditions.push([spec.kind === 'min' ? '>=' : '<=', get, value])
  return ['all', ['has', property], ...conditions] as ExpressionSpecification
}

/**
 * True for communes that satisfy every active filter. A commune with no value for an active filter
 * does not match: an unknown is never treated as a pass.
 */
export function matchExpression(filters: Filters, priceType: PriceType, defs: readonly FilterDef[] = FILTER_DEFS): ExpressionSpecification | null {
  const clauses = defs.flatMap((def) => {
    const value = filters[def.id as FilterKey]
    return value === undefined ? [] : [filterClause(def, value, priceType)]
  })
  return clauses.length === 0 ? null : (['all', ...clauses] as ExpressionSpecification)
}
