import { create } from 'zustand'
import type { Mix } from '../domain/combine'
import { type FilterKey, type FilterValue, type Filters, withFilter, withoutFilters } from '../domain/filters'
import { type TileFields, isAvailable, layerById } from '../domain/layers'
import type { Place, PriceType } from '../domain/place'
import type { ThemeId } from '../domain/themes'
import type { Lang, UrlState } from './urlState'

export interface Selection {
  kind: Place['kind']
  props: Record<string, unknown>
}

export interface FlyRequest {
  lng: number
  lat: number
  zoom: number
  code: string
  nonce: number
}

export interface Manifest {
  version: string
  tiles: { file: string; bytes?: number }
  dataThrough?: string
}

export type MapStatus = 'loading' | 'ready' | 'error'

interface AppState {
  lang: Lang
  priceType: PriceType
  theme: ThemeId
  compare: ThemeId | null
  mix: Mix
  filters: Filters
  /** Opt-in layers (recorded crime) are listed, drawn and filtered only once the visitor asks for them. */
  showOptIn: boolean
  /** Properties the communes tiles carry; null until the tile metadata is read. */
  tileFields: TileFields
  selection: Selection | null
  pendingCode: string | null
  flyRequest: FlyRequest | null
  layersOpen: boolean
  sourcesOpen: boolean
  mapStatus: MapStatus
  manifest: Manifest | null
  setPriceType: (type: PriceType) => void
  setTheme: (theme: ThemeId) => void
  /** Null removes the second indicator; the theme itself, a layer the tiles lack or an opt-in layer is refused. */
  setCompare: (compare: ThemeId | null) => void
  setMix: (mix: Mix) => void
  setFilter: (key: FilterKey, value: FilterValue) => void
  resetFilters: () => void
  setShowOptIn: (show: boolean) => void
  setTileFields: (fields: TileFields) => void
  select: (selection: Selection | null) => void
  flyTo: (target: Omit<FlyRequest, 'nonce'>) => void
  setLayersOpen: (open: boolean) => void
  setSourcesOpen: (open: boolean) => void
  setMapStatus: (status: MapStatus) => void
  setManifest: (manifest: Manifest) => void
}

const isOptIn = (id: string) => layerById(id)?.optIn === true

/** False for a layer whose property the tiles lack: choosing it would only grey the whole map out. */
const isOffered = (id: string, fields: TileFields) => {
  const def = layerById(id)
  return def !== undefined && isAvailable(def, fields)
}

/** What the map draws: the theme, an optional second indicator and the filters. */
export interface Shown {
  theme: ThemeId
  compare: ThemeId | null
  filters: Filters
}

/** A second indicator equal to the theme would show nothing new, so it is dropped. */
const distinct = (shown: Shown): Shown => (shown.compare === shown.theme ? { ...shown, compare: null } : shown)

/** What the tiles can serve: a theme they lack falls back to price, a second indicator they lack is dropped. */
export function withoutMissing({ theme, compare, filters }: Shown, fields: TileFields): Shown {
  return distinct({
    theme: isOffered(theme, fields) ? theme : 'price',
    compare: compare !== null && isOffered(compare, fields) ? compare : null,
    filters: withoutFilters(filters, (def) => !isAvailable(def, fields)),
  })
}

/** Every opt-in layer removed, for visitors who have not opted in. */
export function withoutOptIn({ theme, compare, filters }: Shown): Shown {
  return distinct({
    theme: isOptIn(theme) ? 'price' : theme,
    compare: compare !== null && isOptIn(compare) ? null : compare,
    filters: withoutFilters(filters, (def) => def.optIn === true),
  })
}

export function createStore(initial: UrlState, showOptIn = false, persistOptIn: (show: boolean) => void = () => undefined) {
  const requested: Shown = { theme: initial.theme, compare: initial.compare, filters: initial.filters }
  const start = showOptIn ? distinct(requested) : withoutOptIn(requested)
  const shown = (state: AppState): Shown => ({ theme: state.theme, compare: state.compare, filters: state.filters })
  const canShow = (id: string, state: AppState) => (state.showOptIn || !isOptIn(id)) && isOffered(id, state.tileFields)
  return create<AppState>((set) => ({
    lang: initial.lang,
    priceType: initial.type,
    theme: start.theme,
    compare: start.compare,
    mix: initial.mix,
    filters: start.filters,
    showOptIn,
    tileFields: null,
    selection: null,
    pendingCode: initial.selected,
    flyRequest: null,
    layersOpen: false,
    sourcesOpen: false,
    mapStatus: 'loading',
    manifest: null,
    setPriceType: (priceType) => set({ priceType }),
    // Choosing the second indicator as the theme swaps the two, so both stay on the map.
    setTheme: (theme) => set((state) => (!canShow(theme, state) ? {} : theme === state.compare ? { theme, compare: state.theme } : { theme })),
    setCompare: (compare) => set((state) => (compare !== null && (compare === state.theme || !canShow(compare, state)) ? {} : { compare })),
    setMix: (mix) => set({ mix }),
    setFilter: (key, value) => set((state) => (canShow(key, state) ? { filters: withFilter(state.filters, key, value) } : {})),
    resetFilters: () => set({ filters: {} }),
    setShowOptIn: (show) => {
      persistOptIn(show)
      set((state) => (show ? { showOptIn: true } : { showOptIn: false, ...withoutOptIn(shown(state)) }))
    },
    setTileFields: (tileFields) => set((state) => ({ tileFields, ...withoutMissing(shown(state), tileFields) })),
    select: (selection) => set({ selection, pendingCode: null }),
    flyTo: (target) => set((state) => ({ flyRequest: { ...target, nonce: (state.flyRequest?.nonce ?? 0) + 1 }, pendingCode: target.code })),
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
    setMapStatus: (mapStatus) => set({ mapStatus }),
    setManifest: (manifest) => set({ manifest }),
  }))
}
