import { describe, expect, it } from 'vitest'
import { luminance } from './colour'
import { activeFilterCount, formatFilters, matchExpression, parseFilters, withFilter } from './filters'
import { LADDERS, classIndex, layerById, layerColors, type LayerDef } from './layers'
import { PRICE_COLORS } from './priceLadder'
import { doubtFilters, themeFillExpression } from './themes'

const def = (id: string): LayerDef => {
  const found = layerById(id)
  if (!found) throw new Error(id)
  return found
}

describe('theme ladders', () => {
  it.each(Object.entries(LADDERS))('%s ladder rises in luminance, so it reads without colour', (_name, colors) => {
    const values = colors.map(luminance)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('never reuses a price colour', () => {
    const price = new Set(PRICE_COLORS.map((c) => c.toLowerCase()))
    for (const [name, colours] of Object.entries(LADDERS)) {
      if (name === 'price') continue
      for (const colour of colours) expect(price.has(colour.toLowerCase()), `${name} ${colour}`).toBe(false)
    }
  })

  it('has one distance colour more than breaks', () => {
    const hospital = def('hospital')
    expect(hospital.scale.kind).toBe('steps')
    if (hospital.scale.kind === 'steps') expect(layerColors(hospital)).toHaveLength(hospital.scale.breaks.length + 1)
  })

  it('classes a distance on the lower bound of the next class', () => {
    const hospital = def('hospital')
    expect(classIndex(hospital, 900)).toBe(0)
    expect(classIndex(hospital, 1000)).toBe(1)
    expect(classIndex(hospital, 19_999)).toBe(4)
    expect(classIndex(hospital, 20_000)).toBe(5)
  })

  it('colours by the right tile property', () => {
    expect(JSON.stringify(themeFillExpression('hospital', 'all'))).toContain('d_hos')
    expect(JSON.stringify(themeFillExpression('seismic', 'all'))).toContain('"sz"')
    expect(JSON.stringify(themeFillExpression('price', 'app'))).toContain('p_app')
    expect(JSON.stringify(themeFillExpression('flood', 'all'))).toContain('"fl"')
  })

  it('hatches rough rent estimates only, with the ink flipping inside the ladder', () => {
    expect(doubtFilters('price', 'all')).toBeNull()
    expect(doubtFilters('hospital', 'all')).toBeNull()
    const rent = doubtFilters('rent', 'all')
    expect(JSON.stringify(rent?.light)).toContain('"rtq"')
    // Neither filter uses an infinity, which JSON would turn into null.
    expect(JSON.stringify(rent)).not.toContain('null')
  })
})

describe('filters', () => {
  it('drops a filter at the slider end and clamps below the minimum', () => {
    expect(withFilter({}, 'hospital', 30_000)).toEqual({})
    expect(withFilter({ hospital: 10_000 }, 'hospital', 30_000)).toEqual({})
    expect(withFilter({}, 'hospital', 200)).toEqual({ hospital: 1000 })
    expect(withFilter({}, 'seismic', 3)).toEqual({ seismic: 3 })
  })

  it('round-trips through the URL text and ignores junk', () => {
    const filters = withFilter(withFilter(withFilter({}, 'price', 3500), 'seismic', 3), 'gp', 5000)
    expect(parseFilters(formatFilters(filters))).toEqual(filters)
    expect(parseFilters('price-3500.nope-4.gp-abc.hospital-30000')).toEqual({ price: 3500 })
    expect(parseFilters(null)).toEqual({})
    expect(activeFilterCount(filters)).toBe(3)
  })

  it('builds a match expression only when something is active and never passes an unknown', () => {
    expect(matchExpression({}, 'all')).toBeNull()
    const text = JSON.stringify(matchExpression({ hospital: 15_000, price: 3000 }, 'mai'))
    expect(text).toContain('d_hos')
    expect(text).toContain('p_mai')
    expect(text).toContain('"has"')
  })
})
