import type { ExpressionSpecification } from 'maplibre-gl'
import type { PriceType } from './place'
import { NO_PRICE_COLOR, priceFillExpression } from './priceLadder'

export type DistanceTheme = 'hospital' | 'gp' | 'school' | 'supermarket' | 'bakery' | 'pool'
export type ThemeId = 'price' | 'seismic' | DistanceTheme

export const DISTANCE_THEMES: readonly DistanceTheme[] = ['hospital', 'gp', 'school', 'supermarket', 'bakery', 'pool']
export const THEMES: readonly ThemeId[] = ['price', 'seismic', ...DISTANCE_THEMES]

/** Tile property of each distance, in metres rounded to 100. */
export const DISTANCE_PROPERTY: Record<DistanceTheme, string> = {
  hospital: 'd_hos',
  gp: 'd_gp',
  school: 'd_sch',
  supermarket: 'd_sup',
  bakery: 'd_bak',
  pool: 'd_pool',
}

export const SEISMIC_PROPERTY = 'sz'
export const SEISMIC_ZONES = [1, 2, 3, 4, 5] as const

// Each quantity keeps its own hue (the blue ladder is price's alone) and, like price,
// gets brighter as the value grows: farther, or more exposed.
export const DISTANCE_BREAKS = [1000, 2000, 5000, 10000, 20000] as const
export const DISTANCE_COLORS = ['#0F4C4F', '#12706F', '#1F9E94', '#5CCBB8', '#A5E8D6', '#E2FBF2'] as const
export const SEISMIC_COLORS = ['#2B2466', '#4A3BA0', '#7160D6', '#A99BF0', '#E6E0FF'] as const

export function isTheme(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme === value)
}

export function distanceClass(metres: number): number {
  let index = 0
  while (index < DISTANCE_BREAKS.length && metres >= DISTANCE_BREAKS[index]) index += 1
  return index
}

export function themeFillExpression(theme: ThemeId, priceType: PriceType): ExpressionSpecification {
  if (theme === 'price') return priceFillExpression(priceType)
  if (theme === 'seismic') {
    const cases = SEISMIC_ZONES.flatMap((zone, index) => [zone, SEISMIC_COLORS[index]])
    return ['case', ['has', SEISMIC_PROPERTY], ['match', ['get', SEISMIC_PROPERTY], ...cases, NO_PRICE_COLOR], NO_PRICE_COLOR] as unknown as ExpressionSpecification
  }
  const property = DISTANCE_PROPERTY[theme]
  const stops = DISTANCE_BREAKS.flatMap((limit, index) => [limit, DISTANCE_COLORS[index + 1]])
  return ['case', ['has', property], ['step', ['get', property], DISTANCE_COLORS[0], ...stops], NO_PRICE_COLOR] as ExpressionSpecification
}
