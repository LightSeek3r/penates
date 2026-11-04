import { PRICE_TYPES, type PriceType } from '../domain/place'

export type Lang = 'fr' | 'en'

export interface UrlState {
  lng: number
  lat: number
  zoom: number
  type: PriceType
  selected: string | null
  lang: Lang
}

export const DEFAULT_VIEW = { lng: 2.4, lat: 46.6, zoom: 5 } as const

const COMMUNE_CODE = /^[0-9AB]{5}$/

function finite(value: string | null, min: number, max: number): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export function parseHash(hash: string, fallbackLang: Lang): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const type = params.get('t')
  const selected = params.get('c')
  const lang = params.get('l')
  return {
    lng: finite(params.get('lng'), -180, 180) ?? DEFAULT_VIEW.lng,
    lat: finite(params.get('lat'), -90, 90) ?? DEFAULT_VIEW.lat,
    zoom: finite(params.get('z'), 0, 22) ?? DEFAULT_VIEW.zoom,
    type: PRICE_TYPES.find((candidate) => candidate === type) ?? 'all',
    selected: selected !== null && COMMUNE_CODE.test(selected) ? selected : null,
    lang: lang === 'fr' || lang === 'en' ? lang : fallbackLang,
  }
}

export function formatHash(state: UrlState): string {
  const params = new URLSearchParams()
  params.set('z', state.zoom.toFixed(2))
  params.set('lat', state.lat.toFixed(4))
  params.set('lng', state.lng.toFixed(4))
  params.set('t', state.type)
  if (state.selected) params.set('c', state.selected)
  params.set('l', state.lang)
  return `#${params.toString()}`
}
