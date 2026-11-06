import { describe, expect, it } from 'vitest'
import { contrast } from './colour'
import { LADDERS, LAYERS, NO_DATA_COLOR, type LadderId, layerColors } from './layers'
import { HATCH_INK_DARK, HATCH_INK_LIGHT, HATCH_LIGHT_BELOW, NO_PRICE_COLOR, PRICE_BREAKS, PRICE_COLORS, hatchInkFor, priceClass } from './priceLadder'
import { hatchInkOn } from './themes'

/** OKLCH chroma and hue of a `#RRGGBB` colour (Björn Ottosson's OKLab). */
function oklch(hex: string): { chroma: number; hue: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { chroma: Math.hypot(a, bb), hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

/** Mean hue of the clearly coloured steps of a ladder (the near-white ends carry almost no hue). */
function ladderHue(colours: readonly string[]): number {
  const hues = colours.map(oklch).filter((colour) => colour.chroma >= 0.04)
  const x = hues.reduce((sum, colour) => sum + Math.cos((colour.hue * Math.PI) / 180), 0)
  const y = hues.reduce((sum, colour) => sum + Math.sin((colour.hue * Math.PI) / 180), 0)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
const EXISTING: readonly LadderId[] = ['price', 'distance', 'seismic']
const NEUTRAL: readonly LadderId[] = ['relief', 'safety']

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

describe('indicator ladders stay distinct and legible', () => {
  const ladders = Object.entries(LADDERS) as [LadderId, readonly string[]][]

  // Price marks its gaps with textures (dots, cross-hatch); the other themes rely on value alone.
  it.each(ladders.filter(([name]) => name !== 'price'))('%s ladder starts clearly lighter than the plain no-data ground', (_name, colours) => {
    expect(contrast(colours[0], NO_DATA_COLOR)).toBeGreaterThanOrEqual(1.5)
  })

  it.each(ladders.filter(([name]) => !EXISTING.includes(name) && !NEUTRAL.includes(name)))(
    '%s ladder keeps at least 40 degrees of hue from the price, distance and seismic ladders',
    (_name, colours) => {
      for (const existing of EXISTING) expect(hueGap(ladderHue(colours), ladderHue(LADDERS[existing])), existing).toBeGreaterThanOrEqual(40)
    },
  )

  it.each(NEUTRAL)('%s ladder is a neutral, so it cannot be read as the blue price ladder', (name) => {
    for (const colour of LADDERS[name]) expect(oklch(colour).chroma, colour).toBeLessThan(0.03)
  })

  it('keeps new chromatic ladders apart from one another', () => {
    const chromatic = ladders.filter(([name]) => !NEUTRAL.includes(name))
    for (const [name, colours] of chromatic) {
      for (const [other, otherColours] of chromatic) {
        if (other !== name) expect(hueGap(ladderHue(colours), ladderHue(otherColours)), `${name} / ${other}`).toBeGreaterThanOrEqual(25)
      }
    }
  })

  it('draws the rough-estimate hatch at 3:1 or better on every class of a theme that has one', () => {
    for (const def of LAYERS.filter((entry) => 'doubt' in entry)) {
      for (const fill of layerColors(def)) expect(contrast(fill, hatchInkOn(fill)), `${def.id} ${fill}`).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(ladders)('%s ladder keeps neighbouring classes apart in value', (_name, colours) => {
    for (let index = 1; index < colours.length; index += 1) expect(contrast(colours[index - 1], colours[index]), colours[index]).toBeGreaterThanOrEqual(1.2)
  })

  it('keeps every layer colour distinct from the no-data ground', () => {
    for (const def of LAYERS) for (const fill of layerColors(def)) expect(fill.toLowerCase()).not.toBe(NO_DATA_COLOR.toLowerCase())
  })
})
