import { create } from 'zustand'
import type { Place, PriceType } from '../domain/place'
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
  tiles: { file: string }
  dataThrough?: string
}

export type MapStatus = 'loading' | 'ready' | 'error'

interface AppState {
  lang: Lang
  priceType: PriceType
  selection: Selection | null
  pendingCode: string | null
  flyRequest: FlyRequest | null
  layersOpen: boolean
  sourcesOpen: boolean
  mapStatus: MapStatus
  manifest: Manifest | null
  setLang: (lang: Lang) => void
  setPriceType: (type: PriceType) => void
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
    selection: null,
    pendingCode: initial.selected,
    flyRequest: null,
    layersOpen: false,
    sourcesOpen: false,
    mapStatus: 'loading',
    manifest: null,
    setLang: (lang) => set({ lang }),
    setPriceType: (priceType) => set({ priceType }),
    select: (selection) => set({ selection, pendingCode: null }),
    flyTo: (target) => set((state) => ({ flyRequest: { ...target, nonce: (state.flyRequest?.nonce ?? 0) + 1 }, pendingCode: target.code })),
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
    setMapStatus: (mapStatus) => set({ mapStatus }),
    setManifest: (manifest) => set({ manifest }),
  }))
}
