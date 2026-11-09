import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { type Mix, crossDoubtFilters, crossFillExpression, marksFilter, marksIconExpression } from '../domain/combine'
import { activeFilterCount, matchExpression, type Filters } from '../domain/filters'
import type { PriceType } from '../domain/place'
import { type ThemeId, doubtFilters, themeDef, themeFillExpression } from '../domain/themes'
import { COMMUNES_FROM_TILE_ZOOM, DOUBT_LAYERS, FADE_FROM, LAYER_IDS, MARK_LAYERS, NOTHING, SELECTION_LAYERS, fade, patternFilters } from './style'

export interface Appearance {
  theme: ThemeId
  compare: ThemeId | null
  mix: Mix
  priceType: PriceType
  filters: Filters
}

const LOW_SAMPLE_HATCHES = ['communes-low-light', 'communes-low-dark']
const PRICE_ONLY_PATTERNS = [...LOW_SAMPLE_HATCHES, 'communes-none', 'communes-nocoverage']
const COMMUNE_LAYERS = [LAYER_IDS.communesFill, 'communes-dim', ...PRICE_ONLY_PATTERNS, ...SELECTION_LAYERS.commune]
const DEPARTMENT_LAYERS = [LAYER_IDS.departmentsFill, 'departments-nocoverage']
// Discs of communes outside the criteria stay faintly visible, as their fill does under the dimming layer.
const DIMMED_MARK_OPACITY = 0.3

const show = (map: MapLibreMap, id: string, visible: boolean) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')

/**
 * Applies the theme, the second indicator and the filters. The department picture only exists for price alone; once
 * another theme, a second indicator or any filter is active the commune layer takes over from the lowest tiled zoom,
 * and below it nothing is drawn per commune (the tiles carry no communes there). Price reliability textures stay
 * wherever the fill still describes price; in cross mode the thin-sample hatch joins the other rough-estimate hatch,
 * because one hatch on a combined colour can only mean "at least one of the two figures is rough".
 */
export function applyAppearance(map: MapLibreMap, appearance: Appearance): void {
  const { theme, compare, priceType, filters } = appearance
  const cross = compare !== null && appearance.mix === 'cross'
  const marks = compare !== null && appearance.mix === 'marks'
  const fillShowsPrice = theme === 'price' || (cross && compare === 'price')
  // Both ways of showing a second indicator need commune values, which the department picture does not carry.
  const communesOnly = theme !== 'price' || compare !== null || activeFilterCount(filters) > 0
  const match = matchExpression(filters, priceType)

  const fill = cross ? crossFillExpression(themeDef(theme), themeDef(compare), priceType) : themeFillExpression(theme, priceType)
  for (const id of [LAYER_IDS.communesFill, LAYER_IDS.departmentsFill]) map.setPaintProperty(id, 'fill-color', fill)

  for (const [id, filter] of Object.entries(patternFilters(priceType))) {
    map.setFilter(id, filter)
    show(map, id, fillShowsPrice && (id.startsWith('communes') || !communesOnly) && !(cross && LOW_SAMPLE_HATCHES.includes(id)))
  }

  const doubt = cross ? crossDoubtFilters(themeDef(theme), themeDef(compare), priceType) : doubtFilters(theme, priceType)
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

  map.setFilter('communes-dim', match ? ['!', match] : NOTHING)
  show(map, 'communes-dim', match !== null)

  applyMarks(map, marks ? compare : null, priceType, match)
}

/** Discs follow the commune fill: dimmed like it outside the criteria. */
function applyMarks(map: MapLibreMap, second: ThemeId | null, priceType: PriceType, match: ExpressionSpecification | null): void {
  for (const id of MARK_LAYERS) show(map, id, second !== null)
  if (second === null) return
  const def = themeDef(second)
  for (const id of MARK_LAYERS) {
    map.setFilter(id, marksFilter(def, priceType))
    map.setLayoutProperty(id, 'icon-image', marksIconExpression(def, priceType))
    map.setPaintProperty(id, 'icon-opacity', match ? ['case', match, 1, DIMMED_MARK_OPACITY] : 1)
  }
}
