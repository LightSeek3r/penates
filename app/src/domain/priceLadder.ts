import type { ExpressionSpecification } from 'maplibre-gl'
import type { PriceType } from './place'

// Luminance rises monotonically with price, so the ladder stays readable without hue.
export const PRICE_BREAKS = [1000, 1500, 2000, 2500, 3500, 5000] as const
export const PRICE_COLORS = ['#1D3F85', '#2457B5', '#2F73D9', '#5E97EA', '#93BAF3', '#C9DBF8', '#F4F7FB'] as const
export const NO_PRICE_COLOR = '#14264A'

export function priceClass(price: number): number {
  let index = 0
  while (index < PRICE_BREAKS.length && price >= PRICE_BREAKS[index]) index += 1
  return index
}

export function priceColor(price: number): string {
  return PRICE_COLORS[priceClass(price)]
}

export function priceFillExpression(type: PriceType): ExpressionSpecification {
  const stops = PRICE_BREAKS.flatMap((limit, i) => [limit, PRICE_COLORS[i + 1]])
  return [
    'case',
    ['has', `p_${type}`],
    ['step', ['get', `p_${type}`], PRICE_COLORS[0], ...stops],
    NO_PRICE_COLOR,
  ] as ExpressionSpecification
}

export const HATCH_INK_LIGHT = '#F4F7FB'
export const HATCH_INK_DARK = '#0B1B3A'
// Classes below this price are dark enough for porcelain ink (>= 4:1); the rest take ground ink (>= 5.7:1).
export const HATCH_LIGHT_BELOW = PRICE_BREAKS[2]

export function hatchInkFor(price: number): string {
  return price < HATCH_LIGHT_BELOW ? HATCH_INK_LIGHT : HATCH_INK_DARK
}
