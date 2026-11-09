import { describe, expect, it } from 'vitest'
import { contrast } from './colour'
import { CROSS_COLORS, TIERS } from './combine'
import { LADDERS, LAYERS, NO_DATA_COLOR, type LadderId, layerColors } from './layers'
import { HATCH_INK_DARK, HATCH_INK_LIGHT, HATCH_LIGHT_BELOW, NO_PRICE_COLOR, PRICE_BREAKS, PRICE_COLORS, hatchInkFor, priceClass } from './priceLadder'
import { hatchInkOn } from './themes'

type Rgb = readonly [number, number, number]

const linearRgb = (hex: string): Rgb => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return [r, g, b]
}

/** OKLab of a linear RGB colour (Björn Ottosson). */
function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** OKLCH chroma and hue of a `#RRGGBB` colour. */
function oklch(hex: string): { chroma: number; hue: number } {
  const [, a, bb] = oklab(linearRgb(hex))
  return { chroma: Math.hypot(a, bb), hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

// Full dichromacy (severity 1) from Machado, Oliveira and Fernandes (2009), applied to linear RGB.
const DICHROMACY: Record<string, readonly Rgb[]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}

function simulate(hex: string, matrix: readonly Rgb[]): Rgb {
  const rgb = linearRgb(hex)
  const [r, g, b] = matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])))
  return [r, g, b]
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

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

describe('cross palette stays readable', () => {
  const cells = TIERS.flatMap((second) => TIERS.map((theme) => ({ theme, second, colour: CROSS_COLORS[second][theme] })))
  const AMBER = '#F2A81D'

  it('keeps every cell apart from the no-data ground and hatchable at 3:1', () => {
    for (const { colour } of cells) {
      expect(contrast(colour, NO_DATA_COLOR), colour).toBeGreaterThanOrEqual(1.5)
      expect(contrast(colour, hatchInkOn(colour)), colour).toBeGreaterThanOrEqual(3)
    }
  })

  it('reads by lightness alone along the diagonal and between grid neighbours', () => {
    for (const tier of [1, 2] as const) expect(contrast(CROSS_COLORS[tier][tier], CROSS_COLORS[tier - 1][tier - 1])).toBeGreaterThanOrEqual(2)
    for (const a of cells) {
      for (const b of cells) {
        if (Math.abs(a.theme - b.theme) + Math.abs(a.second - b.second) === 1) expect(contrast(a.colour, b.colour), `${a.colour} / ${b.colour}`).toBeGreaterThanOrEqual(1.4)
      }
    }
  })

  // 0.08 in OKLab is several times the just-noticeable difference (about 0.02), so cells stay apart as map fills.
  it.each([['normal vision', null] as const, ...Object.entries(DICHROMACY)])('keeps all nine cells distinct with %s', (_name, matrix) => {
    const seen = cells.map(({ colour }) => oklab(matrix ? simulate(colour, matrix) : linearRgb(colour)))
    for (let i = 0; i < seen.length; i += 1) {
      for (let j = i + 1; j < seen.length; j += 1) expect(distance(seen[i], seen[j]), `${cells[i].colour} / ${cells[j].colour}`).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('borrows neither the price ladder nor selection amber', () => {
    const priceHue = ladderHue(PRICE_COLORS)
    for (const { colour } of cells) {
      const { chroma, hue } = oklch(colour)
      if (chroma < 0.03) continue
      expect(hueGap(hue, priceHue), colour).toBeGreaterThanOrEqual(40)
      expect(hueGap(hue, oklch(AMBER).hue), colour).toBeGreaterThanOrEqual(40)
    }
    expect(cells.filter(({ colour }) => oklch(colour).chroma < 0.03).map(({ theme, second }) => [theme, second])).toEqual([[0, 0], [1, 1], [2, 2]])
  })
})

describe('second-indicator discs stand out from any fill', () => {
  it('keep one of their two inks at 3:1 on every colour a commune can take', () => {
    const fills = [...Object.values(LADDERS).flat(), ...CROSS_COLORS.flat(), NO_DATA_COLOR, HATCH_INK_DARK]
    for (const fill of fills) expect(Math.max(contrast(fill, HATCH_INK_LIGHT), contrast(fill, HATCH_INK_DARK)), fill).toBeGreaterThanOrEqual(3)
  })
})
