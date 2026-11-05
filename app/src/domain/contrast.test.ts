import { describe, expect, it } from 'vitest'
import { HATCH_INK_DARK, HATCH_INK_LIGHT, HATCH_LIGHT_BELOW, NO_PRICE_COLOR, PRICE_BREAKS, PRICE_COLORS, hatchInkFor, priceClass } from './priceLadder'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

describe('uncertainty encodings stay legible', () => {
  it('draws the thin-sample hatch at 3:1 or better on every price class', () => {
    const lowestPriceOfClass = (index: number) => (index === 0 ? 0 : PRICE_BREAKS[index - 1])
    PRICE_COLORS.forEach((fill, index) => {
      const ink = hatchInkFor(lowestPriceOfClass(index))
      expect(contrast(fill, ink), `class ${index} (${fill}) with ${ink}`).toBeGreaterThanOrEqual(3)
    })
  })

  it('switches ink exactly at the class boundary', () => {
    expect(hatchInkFor(HATCH_LIGHT_BELOW - 1)).toBe(HATCH_INK_LIGHT)
    expect(hatchInkFor(HATCH_LIGHT_BELOW)).toBe(HATCH_INK_DARK)
    expect(priceClass(HATCH_LIGHT_BELOW)).toBe(3)
  })

  it('keeps the no-price ground a different value from the cheapest class, so texture must carry the meaning', () => {
    expect(contrast(PRICE_COLORS[0], NO_PRICE_COLOR)).toBeLessThan(3)
    expect(contrast('#F4F7FB', NO_PRICE_COLOR)).toBeGreaterThanOrEqual(10)
  })
})
