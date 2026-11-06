import type { PriceType } from './place'
import { NO_PRICE_COLOR, PRICE_BREAKS, PRICE_COLORS } from './priceLadder'

/**
 * The single catalogue of map indicators. Themes, filters, legend, details panel and URL state are all generated
 * from these entries; adding an indicator means adding one entry here plus its FR/EN strings under `ind.<id>`.
 *
 * Tile values are optional: a commune without the property is drawn in the no-data colour and never passes a filter.
 */

export const NO_DATA_COLOR = NO_PRICE_COLOR

// One ladder per quantity family (DESIGN.md: the blue ladder is price's alone). Every ladder gets brighter as the
// value grows, so it reads without colour; the first step stays clearly lighter than the no-data ground.
export const LADDERS = {
  price: PRICE_COLORS,
  distance: ['#0F4C4F', '#12706F', '#1F9E94', '#5CCBB8', '#A5E8D6', '#E2FBF2'],
  seismic: ['#41398A', '#594AB6', '#7160D6', '#A99BF0', '#E6E0FF'],
  // Physical risks: earth tones from umber to cream; never red (risks stay calm) nor amber (selection).
  hazard: ['#603F2C', '#885C3A', '#B17F48', '#D2AA6A', '#E8D2A4', '#F8F0DA'],
  relief: ['#4C473F', '#6E665C', '#92897C', '#BAB09F', '#DDD3C2', '#F5F0E4'],
  climate: ['#295233', '#49753F', '#729946', '#A7BD58', '#D6DC81', '#F7F4BD'],
  fibre: ['#65335B', '#904A83', '#BA6AAA', '#D999CA', '#EEC6E4', '#FCEAF7'],
  cost: ['#68373B', '#945154', '#C0716F', '#E09E97', '#F4C9C2', '#FFEBE7'],
  safety: ['#3E4A51', '#5C6A73', '#7E8D96', '#A5B3BC', '#CBD6DD', '#EBF1F5'],
} as const satisfies Record<string, readonly string[]>

export type LadderId = keyof typeof LADDERS

export const GROUPS = ['price', 'risk', 'relief', 'climate', 'services', 'connectivity', 'costs', 'safety'] as const
export type LayerGroup = (typeof GROUPS)[number]

/** What a higher value means for someone choosing where to live. */
export type Direction = 'worse' | 'better' | 'neutral'

/** Display unit; the matching FR/EN template is `units.<unit>`. */
export type Unit = 'eurM2' | 'km' | 'm' | 'hoursYear' | 'daysYear' | 'percent' | 'per1000' | 'eurM2Month' | 'count' | 'class'

/** Values cut into classes at each break (a value equal to a break belongs to the class above). */
export interface StepScale {
  readonly kind: 'steps'
  readonly breaks: readonly number[]
  /** Counts: legend rows read "2 to 4" rather than "2 to 5". */
  readonly integer?: boolean
}

/** A fixed set of class codes, each with its own name (`ind.<id>.classes.<code>`). */
export interface ClassScale {
  readonly kind: 'classes'
  readonly values: readonly number[]
}

export type FilterKind = 'max' | 'min' | 'range' | 'classes'

/**
 * Slider bounds are in tile units and always whole numbers, so filter values never contain the `.` that separates
 * filters in the URL. The end of the slider that means "no limit" switches the filter off: `max` for a maximum,
 * `min` for a minimum, both ends for a range.
 */
export interface SliderFilter {
  readonly kind: 'max' | 'min' | 'range'
  readonly min: number
  readonly max: number
  readonly step: number
}

export interface ClassFilter {
  readonly kind: 'classes'
}

export interface LayerDef {
  /** Theme and filter key in the URL (`th=<id>`, `f=<id>-<value>`) and the i18n key under `ind.`. */
  readonly id: string
  /** Tile property of the communes layer; `{type}` is replaced by the selected price type. */
  readonly property: string
  readonly group: LayerGroup
  readonly ladder: LadderId
  readonly direction: Direction
  readonly unit: Unit
  /** Tile value divided by this before display (metres shown as km). */
  readonly divisor?: number
  /** Decimals in the details panel and filter read-out. */
  readonly decimals?: number
  readonly scale: StepScale | ClassScale
  readonly filter?: SliderFilter | ClassFilter
  /** Hidden from every list until the visitor opts in (recorded crime). */
  readonly optIn?: boolean
  /** Communes where `property < below` are hatched: the value is a rough estimate. */
  readonly doubt?: { readonly property: string; readonly below: number }
  /** Price rows leave the unit to the legend title. */
  readonly rowUnit?: boolean
}

const DISTANCE_BREAKS = [1000, 2000, 5000, 10000, 20000] as const
const DISTANCE_FILTER = { kind: 'max', min: 1000, max: 30000, step: 1000 } as const

const distance = <Id extends string>(id: Id, property: string) =>
  ({
    id,
    property,
    group: 'services',
    ladder: 'distance',
    direction: 'worse',
    unit: 'km',
    divisor: 1000,
    decimals: 1,
    scale: { kind: 'steps', breaks: DISTANCE_BREAKS },
    filter: DISTANCE_FILTER,
  }) as const

export const LAYERS = [
  {
    id: 'price',
    property: 'p_{type}',
    group: 'price',
    ladder: 'price',
    direction: 'neutral',
    unit: 'eurM2',
    scale: { kind: 'steps', breaks: PRICE_BREAKS },
    filter: { kind: 'max', min: 1000, max: 10000, step: 250 },
    rowUnit: false,
  },
  {
    id: 'seismic',
    property: 'sz',
    group: 'risk',
    ladder: 'seismic',
    direction: 'worse',
    unit: 'class',
    scale: { kind: 'classes', values: [1, 2, 3, 4, 5] },
    filter: { kind: 'max', min: 1, max: 5, step: 1 },
  },
  {
    id: 'flood',
    property: 'fl',
    group: 'risk',
    ladder: 'hazard',
    direction: 'worse',
    unit: 'class',
    scale: { kind: 'classes', values: [0, 1, 2, 3] },
    filter: { kind: 'max', min: 0, max: 3, step: 1 },
  },
  {
    id: 'clay',
    property: 'cl',
    group: 'risk',
    ladder: 'hazard',
    direction: 'worse',
    unit: 'class',
    scale: { kind: 'classes', values: [0, 1, 2, 3] },
    filter: { kind: 'max', min: 0, max: 3, step: 1 },
  },
  {
    id: 'radon',
    property: 'rn',
    group: 'risk',
    ladder: 'hazard',
    direction: 'worse',
    unit: 'class',
    scale: { kind: 'classes', values: [1, 2, 3] },
    filter: { kind: 'max', min: 1, max: 3, step: 1 },
  },
  {
    id: 'cavities',
    property: 'cv',
    group: 'risk',
    ladder: 'hazard',
    direction: 'worse',
    unit: 'count',
    scale: { kind: 'steps', breaks: [1, 2, 5, 10, 25], integer: true },
    filter: { kind: 'max', min: 0, max: 20, step: 1 },
  },
  {
    id: 'altitude',
    property: 'alt',
    group: 'relief',
    ladder: 'relief',
    direction: 'neutral',
    unit: 'm',
    scale: { kind: 'steps', breaks: [100, 300, 600, 1000, 1500] },
    filter: { kind: 'range', min: 0, max: 2000, step: 50 },
  },
  {
    id: 'relief',
    property: 'rel',
    group: 'relief',
    ladder: 'relief',
    direction: 'neutral',
    unit: 'm',
    scale: { kind: 'steps', breaks: [50, 100, 200, 400, 800] },
    filter: { kind: 'max', min: 0, max: 1000, step: 25 },
  },
  {
    id: 'sunshine',
    property: 'sun',
    group: 'climate',
    ladder: 'climate',
    direction: 'better',
    unit: 'hoursYear',
    scale: { kind: 'steps', breaks: [1700, 1900, 2100, 2300, 2500] },
    filter: { kind: 'min', min: 1400, max: 2900, step: 50 },
  },
  {
    id: 'heat',
    property: 'hot',
    group: 'climate',
    ladder: 'climate',
    direction: 'worse',
    unit: 'daysYear',
    scale: { kind: 'steps', breaks: [2, 5, 10, 20, 30] },
    filter: { kind: 'max', min: 0, max: 60, step: 1 },
  },
  {
    id: 'heat2050',
    property: 'h50',
    group: 'climate',
    ladder: 'climate',
    direction: 'worse',
    unit: 'daysYear',
    scale: { kind: 'steps', breaks: [2, 5, 10, 20, 30] },
    filter: { kind: 'max', min: 0, max: 80, step: 1 },
  },
  distance('hospital', 'd_hos'),
  distance('gp', 'd_gp'),
  distance('pharmacy', 'd_pha'),
  distance('dentist', 'd_den'),
  distance('creche', 'd_cre'),
  distance('school', 'd_sch'),
  distance('college', 'd_col'),
  distance('lycee', 'd_lyc'),
  distance('supermarket', 'd_sup'),
  distance('bakery', 'd_bak'),
  distance('post', 'd_pos'),
  distance('pool', 'd_pool'),
  distance('station', 'd_gar'),
  {
    id: 'fibre',
    property: 'fb',
    group: 'connectivity',
    ladder: 'fibre',
    direction: 'better',
    unit: 'percent',
    scale: { kind: 'steps', breaks: [10, 30, 60, 80, 95] },
    filter: { kind: 'min', min: 0, max: 100, step: 5 },
  },
  {
    id: 'rent',
    property: 'rt',
    group: 'costs',
    ladder: 'cost',
    direction: 'neutral',
    unit: 'eurM2Month',
    decimals: 1,
    scale: { kind: 'steps', breaks: [8, 10, 12, 15, 20] },
    filter: { kind: 'range', min: 5, max: 30, step: 1 },
    doubt: { property: 'rtq', below: 2 },
  },
  {
    id: 'landtax',
    property: 'tf',
    group: 'costs',
    ladder: 'cost',
    direction: 'worse',
    unit: 'percent',
    decimals: 1,
    scale: { kind: 'steps', breaks: [25, 32, 38, 45, 55] },
    filter: { kind: 'max', min: 10, max: 70, step: 1 },
  },
  {
    id: 'violence',
    property: 'cr_v',
    group: 'safety',
    ladder: 'safety',
    direction: 'worse',
    unit: 'per1000',
    decimals: 1,
    scale: { kind: 'steps', breaks: [1, 2, 4, 6, 10] },
    filter: { kind: 'max', min: 0, max: 20, step: 1 },
    optIn: true,
  },
  {
    id: 'burglary',
    property: 'cr_b',
    group: 'safety',
    ladder: 'safety',
    direction: 'worse',
    unit: 'per1000',
    decimals: 1,
    scale: { kind: 'steps', breaks: [1, 2, 3, 5, 8] },
    filter: { kind: 'max', min: 0, max: 15, step: 1 },
    optIn: true,
  },
] as const satisfies readonly LayerDef[]

export type LayerId = (typeof LAYERS)[number]['id']
export type FilterableLayer = Extract<(typeof LAYERS)[number], { filter: unknown }>
export type FilterKey = FilterableLayer['id']

/** Not a theme: km to the nearest weather station the climate values are interpolated from, shown as a doubt hint. */
export const STATION_DISTANCE_PROPERTY = 'cd'

const BY_ID: ReadonlyMap<string, LayerDef> = new Map(LAYERS.map((def) => [def.id, def]))

export function layerById(id: string): LayerDef | undefined {
  return BY_ID.get(id)
}

export function isLayerId(value: string | null): value is LayerId {
  return value !== null && BY_ID.has(value)
}

export function propertyOf(def: LayerDef, priceType: PriceType): string {
  return def.property.replace('{type}', priceType)
}

/** Visible layers, in catalogue order: opt-in layers only once the visitor has asked for them. */
export function visibleLayers(showOptIn: boolean): readonly LayerDef[] {
  return showOptIn ? LAYERS : LAYERS.filter((def: LayerDef) => !def.optIn)
}

export function layersByGroup(layers: readonly LayerDef[]): ReadonlyArray<{ group: LayerGroup; layers: readonly LayerDef[] }> {
  return GROUPS.flatMap((group) => {
    const members = layers.filter((def) => def.group === group)
    return members.length === 0 ? [] : [{ group, layers: members }]
  })
}

function classCount(def: LayerDef): number {
  return def.scale.kind === 'steps' ? def.scale.breaks.length + 1 : def.scale.values.length
}

/** Picks `count` evenly spaced steps of a ladder, always keeping its darkest and brightest ends. */
export function pickLadder(ladder: readonly string[], count: number): readonly string[] {
  if (count >= ladder.length) return ladder
  if (count === 1) return [ladder[0]]
  return Array.from({ length: count }, (_, index) => ladder[Math.round((index * (ladder.length - 1)) / (count - 1))])
}

const colourCache = new Map<string, readonly string[]>()

/** One colour per class of the layer, darkest first. */
export function layerColors(def: LayerDef): readonly string[] {
  let colours = colourCache.get(def.id)
  if (!colours) {
    colours = pickLadder(LADDERS[def.ladder], classCount(def))
    colourCache.set(def.id, colours)
  }
  return colours
}

/** Class index of a tile value, or null when the value is not one of the layer's class codes. */
export function classIndex(def: LayerDef, value: number): number | null {
  if (def.scale.kind === 'classes') {
    const index = def.scale.values.indexOf(value)
    return index === -1 ? null : index
  }
  let index = 0
  while (index < def.scale.breaks.length && value >= def.scale.breaks[index]) index += 1
  return index
}

/** The tile value of a layer for one feature, or null when absent, not a number or not a known class. */
export function readLayerValue(def: LayerDef, props: Record<string, unknown>, priceType: PriceType = 'all'): number | null {
  const value = props[propertyOf(def, priceType)]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return classIndex(def, value) === null ? null : value
}

/** Value in display units (km rather than metres). */
export const displayValue = (def: LayerDef, value: number): number => value / (def.divisor ?? 1)
