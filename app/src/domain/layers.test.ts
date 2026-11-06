import { describe, expect, it } from 'vitest'
import { THEMES as COUNTED_THEMES, FILTERS as COUNTED_FILTERS } from '../../functions/_lib/events'
import { dictionaries } from '../i18n'
import { FILTER_DEFS, type FilterDef, type FilterValue, type Filters, formatFilters, matchExpression, normaliseFilter, parseFilters } from './filters'
import { GROUPS, LADDERS, LAYERS as CATALOGUE, NO_DATA_COLOR, type LayerDef, layerColors, layersByGroup, pickLadder, readLayerValue, visibleLayers } from './layers'
import { fillExpression } from './themes'

const LAYERS: readonly LayerDef[] = CATALOGUE

type Dictionary = Record<string, unknown>

function lookup(dictionary: Dictionary, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (typeof node === 'object' && node !== null ? (node as Dictionary)[key] : undefined), dictionary)
}

/** Keys every entry must translate. */
function requiredKeys(def: LayerDef): string[] {
  const keys = ['name', 'legend', 'about'].map((key) => `ind.${def.id}.${key}`)
  if (def.filter) keys.push(`ind.${def.id}.filter`)
  if (def.scale.kind === 'classes') {
    keys.push(`ind.${def.id}.short`, `ind.${def.id}.classLabel`, ...def.scale.values.map((code) => `ind.${def.id}.classes.${code}`))
  }
  keys.push(`units.${def.unit}`, `groups.${def.group}.title`)
  if (def.group !== 'price') keys.push(`groups.${def.group}.note`)
  return keys
}

// A small evaluator for the expression subset the catalogue emits, so tests check behaviour rather than JSON shape.
type Expression = unknown
function evaluate(expression: Expression, props: Record<string, unknown>): unknown {
  if (!Array.isArray(expression)) return expression
  const [op, ...args] = expression as [string, ...Expression[]]
  const value = (index: number) => evaluate(args[index], props)
  switch (op) {
    case 'literal':
      return args[0]
    case 'get':
      return props[args[0] as string]
    case 'has':
      return (args[0] as string) in props
    case 'all':
      return args.every((arg) => evaluate(arg, props) === true)
    case '!':
      return !value(0)
    case '<':
      return (value(0) as number) < (value(1) as number)
    case '<=':
      return (value(0) as number) <= (value(1) as number)
    case '>=':
      return (value(0) as number) >= (value(1) as number)
    case 'in':
      return (value(1) as unknown[]).includes(value(0))
    case 'case':
      for (let index = 0; index < args.length - 1; index += 2) if (evaluate(args[index], props) === true) return value(index + 1)
      return evaluate(args.at(-1), props)
    case 'match': {
      const input = value(0)
      for (let index = 1; index < args.length - 1; index += 2) if (args[index] === input) return value(index + 1)
      return evaluate(args.at(-1), props)
    }
    case 'step': {
      const input = value(0) as number
      let result = value(1)
      for (let index = 2; index < args.length; index += 2) if (input >= (args[index] as number)) result = value(index + 1)
      return result
    }
    default:
      throw new Error(`Unsupported operator ${op}`)
  }
}

/** A value strictly inside the slider, i.e. one that keeps the filter on. */
function activeValue(def: FilterDef): FilterValue {
  const spec = def.filter
  if (spec.kind === 'classes') return def.scale.kind === 'classes' ? [def.scale.values[0]] : []
  const middle = spec.min + Math.round((spec.max - spec.min) / spec.step / 2) * spec.step
  if (spec.kind === 'range') return [spec.min + spec.step, spec.max - spec.step]
  return middle
}

const RADON_SET: FilterDef = {
  id: 'radonset',
  property: 'rn',
  group: 'risk',
  ladder: 'hazard',
  direction: 'worse',
  unit: 'class',
  scale: { kind: 'classes', values: [1, 2, 3] },
  filter: { kind: 'classes' },
}

describe('layer catalogue', () => {
  it('names every entry, class, unit and group in French and English', () => {
    for (const def of LAYERS) {
      for (const key of requiredKeys(def)) {
        for (const lang of ['fr', 'en'] as const) {
          const text = lookup(dictionaries[lang] as Dictionary, key)
          expect(typeof text === 'string' && text.length > 0, `${lang} ${key}`).toBe(true)
        }
      }
    }
  })

  it('uses each id and each tile property once', () => {
    const ids = LAYERS.map((def) => def.id)
    const properties = LAYERS.map((def) => def.property)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(properties).size).toBe(properties.length)
    // Ids appear in the URL as `<id>-<value>` joined by dots.
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/)
  })

  it('keeps breaks strictly rising and class codes distinct', () => {
    for (const def of LAYERS) {
      const values = def.scale.kind === 'steps' ? def.scale.breaks : def.scale.values
      const sorted = [...values].sort((a, b) => a - b)
      expect(values, def.id).toEqual(sorted)
      expect(new Set(values).size, def.id).toBe(values.length)
    }
  })

  it('has a colour for every class, taken from a ladder long enough', () => {
    for (const def of LAYERS) {
      const classes = def.scale.kind === 'steps' ? def.scale.breaks.length + 1 : def.scale.values.length
      expect(LADDERS[def.ladder].length, def.id).toBeGreaterThanOrEqual(classes)
      expect(layerColors(def), def.id).toHaveLength(classes)
    }
  })

  it('picks evenly spaced ladder steps, keeping both ends', () => {
    expect(pickLadder(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toEqual(['a', 'c', 'd', 'f'])
    expect(pickLadder(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c'])
  })

  it('declares sliders with whole-number bounds and steps, so URL values never contain the separator', () => {
    for (const def of FILTER_DEFS) {
      const spec = def.filter
      if (spec.kind === 'classes') continue
      for (const bound of [spec.min, spec.max, spec.step]) expect(Number.isInteger(bound), def.id).toBe(true)
      expect(spec.max, def.id).toBeGreaterThan(spec.min)
      expect((spec.max - spec.min) % spec.step, def.id).toBe(0)
    }
  })

  it('groups layers in the fixed group order and keeps crime out unless opted in', () => {
    const groups = layersByGroup(visibleLayers(false)).map((entry) => entry.group)
    expect(groups).toEqual(GROUPS.filter((group) => group !== 'safety'))
    expect(visibleLayers(false).some((def) => def.optIn)).toBe(false)
    expect(layersByGroup(visibleLayers(true)).at(-1)?.group).toBe('safety')
    expect(LAYERS.filter((def) => def.group === 'safety').every((def) => def.optIn)).toBe(true)
  })

  it('lets the usage counter accept every layer except opt-in ones', () => {
    const counted = LAYERS.filter((def) => !def.optIn).map((def) => def.id)
    expect([...COUNTED_THEMES].sort()).toEqual([...counted].sort())
    expect([...COUNTED_FILTERS].sort()).toEqual([...counted].sort())
  })
})

describe('absent values', () => {
  it('colour as no data, never as a class', () => {
    for (const def of LAYERS) expect(evaluate(fillExpression(def, 'all'), { code: '01001' }), def.id).toBe(NO_DATA_COLOR)
  })

  it('colour an unknown class code as no data', () => {
    for (const def of LAYERS.filter((entry) => entry.scale.kind === 'classes')) {
      expect(evaluate(fillExpression(def, 'all'), { [def.property]: 9 }), def.id).toBe(NO_DATA_COLOR)
    }
  })

  it('never pass an active filter, whatever its kind', () => {
    for (const def of [...FILTER_DEFS, RADON_SET]) {
      const filters = { [def.id]: activeValue(def) }
      const match = matchExpression(filters, 'all', [def])
      expect(match, def.id).not.toBeNull()
      expect(evaluate(match, { code: '01001' }), def.id).toBe(false)
    }
  })

  it('are not read as values in the details panel', () => {
    for (const def of LAYERS) {
      expect(readLayerValue(def, {}), def.id).toBeNull()
      expect(readLayerValue(def, { [def.property.replace('{type}', 'all')]: 'n/a' }), def.id).toBeNull()
    }
  })
})

describe('filter semantics', () => {
  const pass = (def: FilterDef, value: FilterValue, tile: number) => evaluate(matchExpression({ [def.id]: value }, 'all', [def]), { [def.property.replace('{type}', 'all')]: tile })
  const byId = (id: string) => FILTER_DEFS.find((def) => def.id === id) as FilterDef

  it('keeps communes at or under a maximum, at or over a minimum, inside a range, or in the chosen classes', () => {
    expect(pass(byId('flood'), 1, 1)).toBe(true)
    expect(pass(byId('flood'), 1, 2)).toBe(false)
    expect(pass(byId('sunshine'), 2000, 2000)).toBe(true)
    expect(pass(byId('sunshine'), 2000, 1990)).toBe(false)
    expect(pass(byId('altitude'), [200, 800], 500)).toBe(true)
    expect(pass(byId('altitude'), [200, 800], 900)).toBe(false)
    expect(pass(byId('altitude'), [0, 800], 0)).toBe(true)
    expect(pass(RADON_SET, [1, 3], 2)).toBe(false)
    expect(pass(RADON_SET, [1, 3], 3)).toBe(true)
  })

  it('switches a filter off at its "no limit" end', () => {
    expect(normaliseFilter(byId('sunshine'), 1400)).toBeUndefined()
    expect(normaliseFilter(byId('fibre'), 0)).toBeUndefined()
    expect(normaliseFilter(byId('altitude'), [0, 2000])).toBeUndefined()
    expect(normaliseFilter(byId('altitude'), [900, 300])).toEqual([300, 900])
    expect(normaliseFilter(RADON_SET, [1, 2, 3])).toBeUndefined()
    expect(normaliseFilter(RADON_SET, [])).toBeUndefined()
  })
})

describe('URL state', () => {
  it('round-trips every filter of the catalogue', () => {
    for (const def of FILTER_DEFS) {
      const filters = { [def.id]: activeValue(def) }
      expect(parseFilters(formatFilters(filters)), def.id).toEqual(filters)
    }
  })

  it('round-trips a class-set filter and all filters at once', () => {
    // A fixture key outside the catalogue, so it goes through the untyped door.
    const classes = { radonset: [1, 3] } as Filters
    expect(formatFilters(classes, [RADON_SET])).toBe('radonset-1_3')
    expect(parseFilters('radonset-1_3', [RADON_SET])).toEqual(classes)
    const everything = Object.fromEntries(FILTER_DEFS.map((def) => [def.id, activeValue(def)]))
    expect(parseFilters(formatFilters(everything))).toEqual(everything)
  })

  it('reads links shared before the catalogue existed exactly as before', () => {
    expect(parseFilters('price-3500.seismic-3.gp-5000')).toEqual({ price: 3500, seismic: 3, gp: 5000 })
    expect(parseFilters('hospital-10000')).toEqual({ hospital: 10000 })
    expect(formatFilters({ gp: 5000, seismic: 3, price: 3500 })).toBe('price-3500.seismic-3.gp-5000')
  })

  it('ignores malformed values for each kind', () => {
    expect(parseFilters('altitude-200')).toEqual({})
    expect(parseFilters('altitude-200_x')).toEqual({})
    expect(parseFilters('flood-1_2')).toEqual({})
    expect(parseFilters('flood-')).toEqual({})
  })
})
