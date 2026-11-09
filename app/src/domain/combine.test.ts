import { type StylePropertySpecification, createExpression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import { CROSS_COLORS, crossDoubtFilters, crossFillExpression, marksFilter, marksIconExpression, markIcon, tierOf, tiersOf } from './combine'
import { LAYERS, NO_DATA_COLOR, type LayerDef, layerById } from './layers'

const def = (id: string): LayerDef => {
  const found = layerById(id)
  if (!found) throw new Error(id)
  return found
}

/** Evaluates an expression the way MapLibre will, so a malformed one fails here rather than in the browser. */
function evaluate(expression: unknown, spec: object, properties: Record<string, unknown>): unknown {
  // deliberate: the bundled spec JSON is typed loosely; createExpression reads only its type and expression fields.
  const parsed = createExpression(expression, 'test', spec as StylePropertySpecification)
  if (parsed.result !== 'success') throw new Error(parsed.value.map((error) => error.message).join('; '))
  return parsed.value.evaluate({ zoom: 9 }, { type: 'Polygon', properties } as never)
}

const fillOf = (theme: string, second: string, properties: Record<string, unknown>) =>
  String(evaluate(crossFillExpression(def(theme), def(second), 'all'), latest.paint_fill['fill-color'], properties)).toLowerCase()
const rgba = (hex: string) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},1)`
const passes = (filter: unknown, properties: Record<string, unknown>) => featureFilter(filter as never, 'test').filter({ zoom: 9 }, { type: 3, properties } as never)

describe('tiers of every catalogue layer', () => {
  // Cut values (tile units) for step scales, class codes for class scales: one line per layer, so a change of breaks
  // or classes has to be reflected here on purpose.
  const EXPECTED: Record<string, ReturnType<typeof tiersOf>> = {
    price: { kind: 'steps', cuts: [1500, 3500] },
    seismic: { kind: 'classes', codes: [[1, 2], [3], [4, 5]] },
    flood: { kind: 'classes', codes: [[0], [1, 2], [3]] },
    clay: { kind: 'classes', codes: [[0], [1, 2], [3]] },
    radon: { kind: 'classes', codes: [[1], [2], [3]] },
    cavities: { kind: 'steps', cuts: [1, 5] },
    altitude: { kind: 'steps', cuts: [300, 1000] },
    relief: { kind: 'steps', cuts: [100, 400] },
    sunshine: { kind: 'steps', cuts: [1900, 2300] },
    heat: { kind: 'steps', cuts: [5, 20] },
    heat2050: { kind: 'steps', cuts: [5, 20] },
    ...Object.fromEntries(
      ['hospital', 'gp', 'pharmacy', 'dentist', 'creche', 'school', 'college', 'lycee', 'supermarket', 'bakery', 'post', 'pool', 'station'].map((id) => [
        id,
        { kind: 'steps', cuts: [2000, 10_000] },
      ]),
    ),
    fibre: { kind: 'steps', cuts: [30, 80] },
    rent: { kind: 'steps', cuts: [10, 15] },
    landtax: { kind: 'steps', cuts: [32, 45] },
    violence: { kind: 'steps', cuts: [2, 6] },
    burglary: { kind: 'steps', cuts: [2, 5] },
  }

  it('covers the whole catalogue', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(LAYERS.map((layer) => layer.id).sort())
  })

  it.each(LAYERS.map((layer) => [layer.id, layer] as const))('%s splits into three non-empty runs of its own legend classes', (id, layer) => {
    const split = tiersOf(layer)
    expect(split).toEqual(EXPECTED[id])
    if (split.kind === 'steps' && layer.scale.kind === 'steps') {
      expect(layer.scale.breaks).toEqual(expect.arrayContaining([...split.cuts]))
      expect(split.cuts[0]).toBeLessThan(split.cuts[1])
    }
    if (split.kind === 'classes' && layer.scale.kind === 'classes') {
      for (const codes of split.codes) expect(codes.length).toBeGreaterThan(0)
      expect(split.codes.flat()).toEqual(layer.scale.values)
    }
  })

  it('places a value equal to a cut in the tier above, like a legend break', () => {
    expect([1499, 1500, 3499, 3500].map((value) => tierOf(def('price'), value))).toEqual([0, 1, 1, 2])
    expect([0, 1, 4, 5].map((value) => tierOf(def('cavities'), value))).toEqual([0, 1, 1, 2])
    expect([1, 2, 3, 4, 5].map((value) => tierOf(def('seismic'), value))).toEqual([0, 0, 1, 2, 2])
    expect(tierOf(def('seismic'), 7)).toBeNull()
  })
})

describe('cross fill', () => {
  it('colours each pair of tiers with its own cell of the palette', () => {
    expect(fillOf('price', 'hospital', { p_all: 900, d_hos: 500 })).toBe(rgba(CROSS_COLORS[0][0]))
    expect(fillOf('price', 'hospital', { p_all: 4000, d_hos: 500 })).toBe(rgba(CROSS_COLORS[0][2]))
    expect(fillOf('price', 'hospital', { p_all: 900, d_hos: 25_000 })).toBe(rgba(CROSS_COLORS[2][0]))
    expect(fillOf('seismic', 'price', { sz: 3, p_all: 2000 })).toBe(rgba(CROSS_COLORS[1][1]))
  })

  it('never draws an absent value or an unknown class as a tier', () => {
    const noData = rgba(NO_DATA_COLOR)
    expect(fillOf('price', 'hospital', { d_hos: 500 })).toBe(noData)
    expect(fillOf('price', 'hospital', { p_all: 900 })).toBe(noData)
    expect(fillOf('seismic', 'price', { sz: 9, p_all: 2000 })).toBe(noData)
    expect(fillOf('price', 'seismic', { p_all: 2000, sz: 9 })).toBe(noData)
  })

  it('hatches a cell when either figure is rough, with the ink the cell colour needs', () => {
    const filters = crossDoubtFilters(def('rent'), def('price'), 'all')
    if (!filters) throw new Error('rent and price can both be rough')
    // Darkest cell (both low) takes porcelain ink; brightest (both high) takes midnight ink.
    expect(passes(filters.light, { rt: 8, rtq: 1, p_all: 900, c_all: 3 })).toBe(true)
    expect(passes(filters.dark, { rt: 8, rtq: 1, p_all: 900, c_all: 3 })).toBe(false)
    expect(passes(filters.dark, { rt: 25, rtq: 3, p_all: 6000, c_all: 1 })).toBe(true)
    expect(passes(filters.light, { rt: 25, rtq: 3, p_all: 6000, c_all: 3 })).toBe(false)
    // A commune drawn as no data carries no hatch: there is no colour to doubt.
    expect(passes(filters.light, { rtq: 1, p_all: 900, c_all: 1 })).toBe(false)
    expect(passes(filters.dark, { rtq: 1, p_all: 900, c_all: 1 })).toBe(false)
    expect(crossDoubtFilters(def('hospital'), def('seismic'), 'all')).toBeNull()
  })
})

describe('marks', () => {
  const icon = (id: string, properties: Record<string, unknown>) => evaluate(marksIconExpression(def(id), 'all'), latest.layout_symbol['icon-image'], properties)

  it('size by tier and open the ring of a rough estimate', () => {
    expect(String(icon('hospital', { d_hos: 500 }))).toBe(markIcon(0, false))
    expect(String(icon('hospital', { d_hos: 15_000 }))).toBe(markIcon(2, false))
    expect(String(icon('price', { p_all: 2000, c_all: 1 }))).toBe(markIcon(1, true))
    expect(String(icon('price', { p_all: 2000, c_all: 3 }))).toBe(markIcon(1, false))
    expect(String(icon('rent', { rt: 16, rtq: 1 }))).toBe(markIcon(2, true))
  })

  it('leave a commune with no value, or an unknown class, without a symbol', () => {
    expect(passes(marksFilter(def('hospital'), 'all'), { d_hos: 500 })).toBe(true)
    expect(passes(marksFilter(def('hospital'), 'all'), { d_gp: 500 })).toBe(false)
    expect(passes(marksFilter(def('seismic'), 'all'), { sz: 9 })).toBe(false)
    expect(passes(marksFilter(def('price'), 'mai'), { p_all: 2000 })).toBe(false)
  })
})
