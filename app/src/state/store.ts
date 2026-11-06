import { create } from 'zustand'
import { type FilterKey, type FilterValue, type Filters, withFilter, withoutFilters } from '../domain/filters'
import { layerById } from '../domain/layers'
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
  filters: Filters
  /** Opt-in layers (recorded crime) are listed, drawn and filtered only once the visitor asks for them. */
  showOptIn: boolean
  selection: Selection | null
  pendingCode: string | null
  flyRequest: FlyRequest | null
  layersOpen: boolean
  sourcesOpen: boolean
  mapStatus: MapStatus
  manifest: Manifest | null
  setPriceType: (type: PriceType) => void
  setTheme: (theme: ThemeId) => void
  setFilter: (key: FilterKey, value: FilterValue) => void
  resetFilters: () => void
  setShowOptIn: (show: boolean) => void
  select: (selection: Selection | null) => void
  flyTo: (target: Omit<FlyRequest, 'nonce'>) => void
  setLayersOpen: (open: boolean) => void
  setSourcesOpen: (open: boolean) => void
  setMapStatus: (status: MapStatus) => void
  setManifest: (manifest: Manifest) => void
}

const isOptIn = (id: string) => layerById(id)?.optIn === true

/** Theme and filters with every opt-in layer removed, for visitors who have not opted in. */
export function withoutOptIn(theme: ThemeId, filters: Filters): { theme: ThemeId; filters: Filters } {
  return { theme: isOptIn(theme) ? 'price' : theme, filters: withoutFilters(filters, (def) => def.optIn === true) }
}

export function createStore(initial: UrlState, showOptIn = false, persistOptIn: (show: boolean) => void = () => undefined) {
  const start = showOptIn ? { theme: initial.theme, filters: initial.filters } : withoutOptIn(initial.theme, initial.filters)
  return create<AppState>((set) => ({
    lang: initial.lang,
    priceType: initial.type,
    theme: start.theme,
    filters: start.filters,
    showOptIn,
    selection: null,
    pendingCode: initial.selected,
    flyRequest: null,
    layersOpen: false,
    sourcesOpen: false,
    mapStatus: 'loading',
    manifest: null,
    setPriceType: (priceType) => set({ priceType }),
    setTheme: (theme) => set((state) => (isOptIn(theme) && !state.showOptIn ? {} : { theme })),
    setFilter: (key, value) => set((state) => (isOptIn(key) && !state.showOptIn ? {} : { filters: withFilter(state.filters, key, value) })),
    resetFilters: () => set({ filters: {} }),
    setShowOptIn: (show) => {
      persistOptIn(show)
      set((state) => (show ? { showOptIn: true } : { showOptIn: false, ...withoutOptIn(state.theme, state.filters) }))
    },
    select: (selection) => set({ selection, pendingCode: null }),
    flyTo: (target) => set((state) => ({ flyRequest: { ...target, nonce: (state.flyRequest?.nonce ?? 0) + 1 }, pendingCode: target.code })),
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
    setMapStatus: (mapStatus) => set({ mapStatus }),
    setManifest: (manifest) => set({ manifest }),
  }))
}
