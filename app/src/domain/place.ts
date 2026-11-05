import { DISTANCE_PROPERTY, DISTANCE_THEMES, SEISMIC_PROPERTY, type DistanceTheme } from './themes'

export type PriceType = 'all' | 'mai' | 'app'
export const PRICE_TYPES: readonly PriceType[] = ['all', 'mai', 'app']

export const CONFIDENCE = { insufficient: 0, low: 1, medium: 2, high: 3, noCoverage: 4 } as const
export type Confidence = (typeof CONFIDENCE)[keyof typeof CONFIDENCE]

export const TREND_YEARS = [2021, 2022, 2023, 2024, 2025] as const

export interface Place {
  code: string
  name: string
  dep: string | null
  kind: 'commune' | 'department'
  price: number | null
  sales: number
  confidence: Confidence
  trend: (number | null)[]
  windowMonths: number
  period: string | null
}

type TileProps = Record<string, unknown>

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function confidenceOf(value: unknown): Confidence {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : CONFIDENCE.insufficient
}

export function readPlace(props: TileProps, type: PriceType, kind: Place['kind']): Place {
  return {
    code: String(props.code ?? ''),
    name: String(props.name ?? ''),
    dep: typeof props.dep === 'string' ? props.dep : null,
    kind,
    price: num(props[`p_${type}`]),
    sales: num(props[`n_${type}`]) ?? 0,
    confidence: confidenceOf(props[`c_${type}`]),
    trend: TREND_YEARS.map((year) => num(props[`t${year}`])),
    windowMonths: num(props.w) ?? 36,
    period: typeof props.period === 'string' ? props.period : null,
  }
}

export interface Indicators {
  seismicZone: number | null
  /** Straight-line distance in metres to the nearest facility of each kind. */
  distances: Partial<Record<DistanceTheme, number>>
}

export function readIndicators(props: Record<string, unknown>): Indicators {
  const zone = num(props[SEISMIC_PROPERTY])
  const distances: Indicators['distances'] = {}
  for (const theme of DISTANCE_THEMES) {
    const metres = num(props[DISTANCE_PROPERTY[theme]])
    if (metres !== null) distances[theme] = metres
  }
  return { seismicZone: zone !== null && zone >= 1 && zone <= 5 ? zone : null, distances }
}
