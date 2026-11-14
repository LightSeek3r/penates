/**
 * Overlays: layers drawn over the colour theme, switched on independently. Places are dots (one pictogram per kind),
 * risks are isolines. The catalogue, the line styles, the availability rules and the URL helpers live here; the map
 * style, the store and the panels are generated from them.
 *
 * The ids of `PLACE_KINDS` are the `k` property of the `places` layer in `overlays.pmtiles`; the pipeline's
 * `pipeline/settling/overlays/kinds.json` is the other copy, and a test in each language compares the two.
 */

export const PLACE_FAMILIES = ['health', 'education', 'daily', 'leisure'] as const
export type PlaceFamily = (typeof PLACE_FAMILIES)[number]

export interface PlaceKindDef {
  /** `k` in the tiles, `ov=` in the link, `places.<id>` in the strings. */
  readonly id: string
  readonly family: PlaceFamily
  /** Lowest zoom at which the dot is in the tiles; the map shows nothing below it. */
  readonly minZoom: number
}

export const PLACE_KINDS = [
  { id: 'hos', family: 'health', minZoom: 6 },
  { id: 'gp', family: 'health', minZoom: 10 },
  { id: 'pha', family: 'health', minZoom: 10 },
  { id: 'den', family: 'health', minZoom: 10 },
  { id: 'cre', family: 'education', minZoom: 10 },
  { id: 'mat', family: 'education', minZoom: 10 },
  { id: 'pri', family: 'education', minZoom: 10 },
  { id: 'col', family: 'education', minZoom: 8 },
  { id: 'lyc', family: 'education', minZoom: 8 },
  { id: 'uni', family: 'education', minZoom: 7 },
  { id: 'sup', family: 'daily', minZoom: 9 },
  { id: 'bak', family: 'daily', minZoom: 10 },
  { id: 'pos', family: 'daily', minZoom: 10 },
  { id: 'sta', family: 'daily', minZoom: 7 },
  { id: 'pool', family: 'leisure', minZoom: 8 },
  { id: 'cin', family: 'leisure', minZoom: 8 },
  { id: 'lib', family: 'leisure', minZoom: 9 },
] as const satisfies readonly PlaceKindDef[]

export type PlaceKindId = (typeof PLACE_KINDS)[number]['id']

/** Natural and industrial risks, drawn as lines. */
export const RISK_OVERLAYS = ['seismic', 'flood', 'clay', 'radon', 'cavities'] as const
export type RiskOverlayId = (typeof RISK_OVERLAYS)[number]
export type OverlayId = PlaceKindId | RiskOverlayId

/** Risks first, then the place families, in the order the panel lists them. */
export const OVERLAY_GROUPS = ['risk', ...PLACE_FAMILIES] as const
export type OverlayGroup = (typeof OVERLAY_GROUPS)[number]

export interface OverlayDef {
  readonly id: OverlayId
  readonly group: OverlayGroup
  readonly kind: 'place' | 'risk'
}

export const OVERLAYS: readonly OverlayDef[] = [
  ...RISK_OVERLAYS.map((id): OverlayDef => ({ id, group: 'risk', kind: 'risk' })),
  ...PLACE_KINDS.map((place): OverlayDef => ({ id: place.id, group: place.family, kind: 'place' })),
]

const BY_ID: ReadonlyMap<string, OverlayDef> = new Map(OVERLAYS.map((def) => [def.id, def]))

/** Keeps the ids that are on, in catalogue order and without repeats. */
const inCatalogueOrder = (on: (id: OverlayId) => boolean): readonly OverlayId[] => OVERLAYS.map((def) => def.id).filter(on)

export function isOverlayId(value: string | null): value is OverlayId {
  return value !== null && BY_ID.has(value)
}

export function overlayById(id: OverlayId): OverlayDef
export function overlayById(id: string): OverlayDef | undefined
export function overlayById(id: string): OverlayDef | undefined {
  return BY_ID.get(id)
}

export const isPlaceKind = (value: string | null): value is PlaceKindId => value !== null && BY_ID.get(value)?.kind === 'place'

/** Narrows an overlay to a place kind, and so, in the other branch, to a risk. */
export const isPlaceOverlay = (id: OverlayId): id is PlaceKindId => isPlaceKind(id)

// Every risk is a set of isolines in the overlays archive: a line marks where a value rises to at least its level. The
// values are per commune, so the lines follow commune borders.

/** Zone (`z` in the `seismic` layer) the ground rises to across a line; one entry of `RISK_STYLE.seismic.widths` each. */
export const SEISMIC_LEVELS = [2, 3, 4, 5] as const

export interface RiskLineDef {
  /** Property of the communes layer the line is cut from; the same one as the catalogue layer of the same name (a test compares them). */
  readonly property: string
  /** Levels (`z` in the `risk` layer) a line is drawn at, ascending; one entry of `RISK_STYLE[id].widths` each. */
  readonly levels: readonly number[]
}

// Radon class 1 is "low potential": most communes of the Massif central and Brittany would be enclosed by a line.
export const RISK_LINES = {
  flood: { property: 'fl', levels: [1, 2, 3] },
  clay: { property: 'cl', levels: [1, 2, 3] },
  radon: { property: 'rn', levels: [2, 3] },
  cavities: { property: 'cv', levels: [1, 5, 25] },
} as const satisfies Partial<Record<RiskOverlayId, RiskLineDef>>

/** The levels a risk overlay draws lines at, ascending: the order of its `RISK_STYLE` widths. */
export const riskLevels = (id: RiskOverlayId): readonly number[] => (id === 'seismic' ? SEISMIC_LEVELS : RISK_LINES[id].levels)

export interface RiskStyle {
  /** Line colour; the map draws a midnight casing under it, so the pair reads on every fill. */
  readonly ink: string
  /** Dash and gap in line widths: a second cue that does not rely on colour. Solid when absent. */
  readonly dash?: readonly number[]
  /** Line width in px at zoom 8, one per level of `riskLevels(id)`. */
  readonly widths: readonly number[]
}

/**
 * Line styles of the risk overlays, used by the map style and by the panel swatches alike. Inks are light enough that
 * the ink or its casing keeps 3:1 on every price class and the no-data ground (overlays.test.ts), apart from one
 * another under colour-vision deficiencies, and clear of selection amber, error scarlet and the price blues.
 */
/**
 * Zoom a risk's lines start at when the country view would read as noise: clay and cavities are scattered over many
 * small groups of communes, so every group would be drawn at once (seen on the live site, 2026-11-14). Absent: from the
 * lowest zoom the archive holds.
 */
export const RISK_FROM_ZOOM: Partial<Record<RiskOverlayId, number>> = { clay: 7, cavities: 7 }

export const RISK_STYLE: Record<RiskOverlayId, RiskStyle> = {
  // Lilac, as the seismic colour theme was; the only solid line, heavier with the zone.
  seismic: { ink: '#B99EFE', widths: [1.2, 1.9, 2.7, 3.5] },
  // Silt, terracotta, moss and limestone: earth tones that are neither selection amber nor a price blue nor red.
  flood: { ink: '#F9F6B6', dash: [4, 2], widths: [1.2, 1.8, 2.6] },
  clay: { ink: '#D8A096', dash: [1.6, 1.6], widths: [1.2, 1.8, 2.6] },
  radon: { ink: '#BDD174', dash: [4, 2, 1, 2], widths: [1.5, 2.4] },
  cavities: { ink: '#F3D0BE', dash: [0.8, 2.4], widths: [1.4, 2, 2.8] },
}

/** What the overlays archive holds, read from its manifest. */
export interface OverlaySources {
  /** Kinds of the `places` layer with at least one dot. */
  places: ReadonlySet<string>
  /** True when the `seismic` layer has lines. */
  seismic: boolean
  /** Ids of the `risk` layer (flood, clay, radon, cavities) with at least one line, at any level. */
  risks: ReadonlySet<string>
}

/** Whether the data behind an overlay is there. Everything comes from the overlays archive: without its manifest (`sources` null) nothing is offered. */
export function isOverlayAvailable(id: OverlayId, sources: OverlaySources | null): boolean {
  if (sources === null) return false
  if (isPlaceOverlay(id)) return sources.places.has(id)
  return id === 'seismic' ? sources.seismic : sources.risks.has(id)
}

/** A new list with one overlay switched on or off, always in catalogue order and without duplicates. */
export const withOverlay = (ids: readonly OverlayId[], id: OverlayId, on: boolean): readonly OverlayId[] =>
  inCatalogueOrder((candidate) => (candidate === id ? on : ids.includes(candidate)))

/** Ids of the place overlays that are on, which are the `k` values the dot layers keep. */
export const placeKindsOf = (ids: readonly OverlayId[]): readonly PlaceKindId[] => PLACE_KINDS.map((kind) => kind.id).filter((id) => ids.includes(id))

// URL text: the ids joined by commas, in catalogue order (`ov=seismic,hos,gp`).
const SEPARATOR = ','

/** Overlays named in a comma list: unknown ids and repeats are dropped, the rest comes back in catalogue order. */
export function parseOverlays(param: string | null): readonly OverlayId[] {
  const named = new Set((param ?? '').split(SEPARATOR).map((part) => part.trim()))
  return inCatalogueOrder((id) => named.has(id))
}

export const formatOverlays = (ids: readonly OverlayId[]): string => inCatalogueOrder((id) => ids.includes(id)).join(SEPARATOR)

/** A dot the visitor clicked: what the card shows, and where it sits. */
export interface PlaceSelection {
  kind: PlaceKindId
  /** Public institutions only; never set for practices and shops. */
  name: string | null
  /** How many places of the kind share this position. */
  count: number
  /** The source gives only an approximate position. */
  approximate: boolean
  lng: number
  lat: number
}

/**
 * The place a dot of the `places` layer stands for, from its tile properties (`k` kind, `n` name, `c` count of places
 * at that position, `a` = 1 for an approximate position) and its coordinates. Null for a kind this app does not know.
 */
export function readPlaceFeature(properties: Record<string, unknown> | null, lng: number, lat: number): PlaceSelection | null {
  const kind = properties?.k
  if (typeof kind !== 'string' || !isPlaceKind(kind)) return null
  const { n, c, a } = properties ?? {}
  return { kind, name: typeof n === 'string' && n !== '' ? n : null, count: typeof c === 'number' && c >= 1 ? c : 1, approximate: a === 1, lng, lat }
}
