import { describe, expect, it } from 'vitest'
import { CONFIDENCE, readPlace } from './place'
import { NO_PRICE_COLOR, PRICE_BREAKS, PRICE_COLORS, priceClass, priceColor, priceFillExpression } from './priceLadder'

describe('priceClass', () => {
  it('puts a price on the lower bound of the next class', () => {
    expect(priceClass(999)).toBe(0)
    expect(priceClass(1000)).toBe(1)
    expect(priceClass(4999)).toBe(5)
    expect(priceClass(5000)).toBe(6)
    expect(priceClass(12000)).toBe(6)
  })

  it('has one colour more than breaks, rising in luminance', () => {
    expect(PRICE_COLORS).toHaveLength(PRICE_BREAKS.length + 1)
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const values = PRICE_COLORS.map(luminance)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('colours by class', () => {
    expect(priceColor(800)).toBe(PRICE_COLORS[0])
    expect(priceColor(9400)).toBe(PRICE_COLORS[6])
  })
})

describe('priceFillExpression', () => {
  it('falls back to the no-price colour when the property is absent', () => {
    const expression = priceFillExpression('app') as unknown[]
    expect(expression[0]).toBe('case')
    expect(expression[1]).toEqual(['has', 'p_app'])
    expect(expression.at(-1)).toBe(NO_PRICE_COLOR)
  })
})

describe('readPlace', () => {
  const props = { code: '69123', name: 'Lyon', dep: '69', p_all: 5012, n_all: 812, c_all: 3, p_mai: 5400, c_mai: 2, t2021: 4500, t2025: 5012, w: 36 }

  it('reads the selected price type only', () => {
    const place = readPlace(props, 'all', 'commune')
    expect(place).toMatchObject({ code: '69123', name: 'Lyon', price: 5012, sales: 812, confidence: CONFIDENCE.high, windowMonths: 36 })
    expect(readPlace(props, 'mai', 'commune').price).toBe(5400)
  })

  it('keeps missing trend years as null and missing price as null', () => {
    const place = readPlace(props, 'app', 'commune')
    expect(place.price).toBeNull()
    expect(place.confidence).toBe(CONFIDENCE.insufficient)
    expect(readPlace(props, 'all', 'commune').trend).toEqual([4500, null, null, null, 5012])
  })

  it('treats an unknown confidence value as insufficient', () => {
    expect(readPlace({ code: '1', name: 'x', c_all: 9 }, 'all', 'commune').confidence).toBe(CONFIDENCE.insufficient)
  })
})
