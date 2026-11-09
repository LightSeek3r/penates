import { type Mix, isMix } from '../domain/combine'
import { type Filters, formatFilters, parseFilters } from '../domain/filters'
import { PRICE_TYPES, type PriceType } from '../domain/place'
import { type ThemeId, isTheme } from '../domain/themes'

export type Lang = 'fr' | 'en'

export interface UrlState {
  lng: number
  lat: number
  zoom: number
  type: PriceType
  selected: string | null
  lang: Lang
  theme: ThemeId
  /** Second indicator shown with the theme, never the theme itself. */
  compare: ThemeId | null
  /** How the second indicator is drawn; kept while there is none, so adding one again reuses the last choice. */
  mix: Mix
  filters: Filters
  /** False when the link carries no map position, so the app frames the whole country. */
  viewProvided: boolean
}

export const DEFAULT_VIEW = { lng: 2.4, lat: 46.6, zoom: 5 } as const

const COMMUNE_CODE = /^[0-9AB]{5}$/

function finite(value: string | null, min: number, max: number): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

/** The language is carried by the page path (`/` French, `/en/` English), never by the hash. */
export function parseHash(hash: string, lang: Lang): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const type = params.get('t')
  const selected = params.get('c')
  const requested = params.get('th')
  const theme: ThemeId = isTheme(requested) ? requested : 'price'
  const compare = params.get('th2')
  const mix = params.get('mix')
  const lng = finite(params.get('lng'), -180, 180)
  const lat = finite(params.get('lat'), -90, 90)
  const zoom = finite(params.get('z'), 0, 22)
  return {
    lng: lng ?? DEFAULT_VIEW.lng,
    lat: lat ?? DEFAULT_VIEW.lat,
    zoom: zoom ?? DEFAULT_VIEW.zoom,
    viewProvided: lng !== null && lat !== null && zoom !== null,
    type: PRICE_TYPES.find((candidate) => candidate === type) ?? 'all',
    selected: selected !== null && COMMUNE_CODE.test(selected) ? selected : null,
    lang,
    theme,
    compare: isTheme(compare) && compare !== theme ? compare : null,
    mix: isMix(mix) ? mix : 'cross',
    filters: parseFilters(params.get('f')),
  }
}

export function formatHash(state: Omit<UrlState, 'viewProvided' | 'lang'>): string {
  const params = new URLSearchParams()
  params.set('z', state.zoom.toFixed(2))
  params.set('lat', state.lat.toFixed(4))
  params.set('lng', state.lng.toFixed(4))
  params.set('t', state.type)
  if (state.selected) params.set('c', state.selected)
  if (state.theme !== 'price') params.set('th', state.theme)
  if (state.compare) {
    params.set('th2', state.compare)
    params.set('mix', state.mix)
  }
  const filters = formatFilters(state.filters)
  if (filters) params.set('f', filters)
  return `#${params.toString()}`
}
