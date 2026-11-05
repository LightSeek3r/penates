import { create } from 'zustand'
import { type FilterKey, type Filters, withFilter } from '../domain/filters'
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
  selection: Selection | null
  pendingCode: string | null
  flyRequest: FlyRequest | null
  layersOpen: boolean
  sourcesOpen: boolean
  mapStatus: MapStatus
  manifest: Manifest | null
  setPriceType: (type: PriceType) => void
  setTheme: (theme: ThemeId) => void
  setFilter: (key: FilterKey, value: number) => void
  resetFilters: () => void
  select: (selection: Selection | null) => void
  flyTo: (target: Omit<FlyRequest, 'nonce'>) => void
  setLayersOpen: (open: boolean) => void
  setSourcesOpen: (open: boolean) => void
  setMapStatus: (status: MapStatus) => void
  setManifest: (manifest: Manifest) => void
}

export function createStore(initial: UrlState) {
  return create<AppState>((set) => ({
    lang: initial.lang,
    priceType: initial.type,
    theme: initial.theme,
    filters: initial.filters,
    selection: null,
    pendingCode: initial.selected,
    flyRequest: null,
    layersOpen: false,
    sourcesOpen: false,
    mapStatus: 'loading',
    manifest: null,
    setPriceType: (priceType) => set({ priceType }),
    setTheme: (theme) => set({ theme }),
    setFilter: (key, value) => set((state) => ({ filters: withFilter(state.filters, key, value) })),
    resetFilters: () => set({ filters: {} }),
    select: (selection) => set({ selection, pendingCode: null }),
    flyTo: (target) => set((state) => ({ flyRequest: { ...target, nonce: (state.flyRequest?.nonce ?? 0) + 1 }, pendingCode: target.code })),
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
    setMapStatus: (mapStatus) => set({ mapStatus }),
    setManifest: (manifest) => set({ manifest }),
  }))
}
