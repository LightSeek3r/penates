import { describe, expect, it } from 'vitest'
import { activeFilterCount, formatFilters, matchExpression, parseFilters, withFilter } from './filters'
import { DISTANCE_BREAKS, DISTANCE_COLORS, SEISMIC_COLORS, distanceClass, themeFillExpression } from './themes'
import { PRICE_COLORS } from './priceLadder'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('theme ladders', () => {
  it.each([
    ['distance', DISTANCE_COLORS],
    ['seismic', SEISMIC_COLORS],
  ])('%s ladder rises in luminance, so it reads without colour', (_name, colors) => {
    const values = colors.map(luminance)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('never reuses a price colour', () => {
    const price = new Set(PRICE_COLORS.map((c) => c.toLowerCase()))
    for (const colour of [...DISTANCE_COLORS, ...SEISMIC_COLORS]) expect(price.has(colour.toLowerCase())).toBe(false)
  })

  it('has one distance colour more than breaks', () => {
    expect(DISTANCE_COLORS).toHaveLength(DISTANCE_BREAKS.length + 1)
  })

  it('classes a distance on the lower bound of the next class', () => {
    expect(distanceClass(900)).toBe(0)
    expect(distanceClass(1000)).toBe(1)
    expect(distanceClass(19_999)).toBe(4)
    expect(distanceClass(20_000)).toBe(5)
  })

  it('colours by the right tile property', () => {
    expect(JSON.stringify(themeFillExpression('hospital', 'all'))).toContain('d_hos')
    expect(JSON.stringify(themeFillExpression('seismic', 'all'))).toContain('"sz"')
    expect(JSON.stringify(themeFillExpression('price', 'app'))).toContain('p_app')
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
