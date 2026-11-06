import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { activeFilterCount, matchExpression, type Filters } from '../domain/filters'
import type { PriceType } from '../domain/place'
import { type ThemeId, doubtFilters, themeFillExpression } from '../domain/themes'
import { COMMUNES_FROM_TILE_ZOOM, DOUBT_LAYERS, FADE_FROM, LAYER_IDS, SELECTION_LAYERS, fade, patternFilters } from './style'

export interface Appearance {
  theme: ThemeId
  priceType: PriceType
  filters: Filters
}

const PRICE_ONLY_PATTERNS = ['communes-low-light', 'communes-low-dark', 'communes-none', 'communes-nocoverage']
const COMMUNE_LAYERS = [LAYER_IDS.communesFill, 'communes-dim', ...PRICE_ONLY_PATTERNS, ...SELECTION_LAYERS.commune]
const DEPARTMENT_LAYERS = [LAYER_IDS.departmentsFill, 'departments-nocoverage']
const NOTHING: FilterSpecification = ['==', ['get', 'code'], '']

const show = (map: MapLibreMap, id: string, visible: boolean) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')

/**
 * Applies the chosen theme and filters. The department picture only exists for price; once another
 * theme or any filter is active the commune layer takes over from the lowest tiled zoom, and the
 * reliability textures (which describe price samples) are hidden.
 */
export function applyAppearance(map: MapLibreMap, { theme, priceType, filters }: Appearance): void {
  const price = theme === 'price'
  const communesOnly = !price || activeFilterCount(filters) > 0

  const fill = themeFillExpression(theme, priceType)
  for (const id of [LAYER_IDS.communesFill, LAYER_IDS.departmentsFill]) map.setPaintProperty(id, 'fill-color', fill)

  for (const [id, filter] of Object.entries(patternFilters(priceType))) {
    map.setFilter(id, filter)
    show(map, id, price && (id.startsWith('communes') || !communesOnly))
  }

  const doubt = doubtFilters(theme, priceType)
  const [light, dark] = DOUBT_LAYERS
  map.setFilter(light, doubt ? doubt.light : NOTHING)
  map.setFilter(dark, doubt ? doubt.dark : NOTHING)
  for (const id of DOUBT_LAYERS) show(map, id, doubt !== null)

  for (const id of DEPARTMENT_LAYERS) if (!id.endsWith('nocoverage')) show(map, id, !communesOnly)

  const from = communesOnly ? COMMUNES_FROM_TILE_ZOOM : FADE_FROM
  for (const id of COMMUNE_LAYERS) map.setLayerZoomRange(id, from, 24)
  const opacity = communesOnly ? 0.94 : fade(0.94, true)
  map.setPaintProperty(LAYER_IDS.communesFill, 'fill-opacity', opacity)
  for (const id of PRICE_ONLY_PATTERNS) map.setPaintProperty(id, 'fill-opacity', id === 'communes-nocoverage' ? 0.75 : opacity)

  const match = matchExpression(filters, priceType)
  map.setFilter('communes-dim', match ? ['!', match] : NOTHING)
  show(map, 'communes-dim', match !== null)
}
