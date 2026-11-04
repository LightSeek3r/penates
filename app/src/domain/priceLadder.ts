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
