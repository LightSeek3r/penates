import type { ExpressionSpecification, FilterSpecification, GeoJSONSourceSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { markIcon } from '../domain/combine'
import type { PriceType } from '../domain/place'
import { HATCH_LIGHT_BELOW, priceFillExpression } from '../domain/priceLadder'
// Fetched and parsed by MapLibre's worker rather than bundled: 128 KB less JavaScript to parse on the main thread.
import kmGridUrl from './km-grid.json?url'
import type { Lang } from '../state/urlState'

export const GROUND = '#0B1B3A'
const PORCELAIN = '#F4F7FB'
const COBALT = '#2F6FDB'
const AMBER = '#F2A81D'
const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

// Departments carry the picture up to the cross-fade; communes take over from here.
export const FADE_FROM = 6
const FADE_TO = 7
// Lowest zoom the commune layer is tiled at; used instead of the department picture when a theme or filter needs communes.
export const COMMUNES_FROM_TILE_ZOOM = 4

export const fade = (opacity: number, rising: boolean): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  FADE_FROM,
  rising ? 0 : opacity,
  FADE_TO,
  rising ? opacity : 0,
]

const confidence = (type: PriceType, value: number): ExpressionSpecification => ['==', ['get', `c_${type}`], value]

/** Filters of the pattern layers, which depend on the selected price type. */
export function patternFilters(type: PriceType): Record<string, FilterSpecification> {
  const price: ExpressionSpecification = ['coalesce', ['get', `p_${type}`], 0]
  const low = confidence(type, 1)
  return {
    // Hatch ink flips with the price class so it stays at least 3:1 against the fill.
    'communes-low-light': ['all', low, ['<', price, HATCH_LIGHT_BELOW]],
    'communes-low-dark': ['all', low, ['>=', price, HATCH_LIGHT_BELOW]],
    'communes-none': confidence(type, 0),
    'communes-nocoverage': confidence(type, 4),
    'departments-nocoverage': confidence(type, 4),
  }
}

/** Hatch layers for rough estimates on non-price themes: porcelain ink, then midnight ink. */
export const DOUBT_LAYERS = ['communes-doubt-light', 'communes-doubt-dark'] as const

/**
 * Discs of the second indicator: thinned by collision while communes are small, then one per commune once they are
 * large enough to hold one. From that zoom place names are drawn over the discs instead of hiding them.
 */
export const MARK_LAYERS = ['communes-marks-thinned', 'communes-marks'] as const
const MARKS_ALL_FROM = 9
// A disc is placed once per tile a commune falls in, so every tile edge that cuts a commune would give it two discs.
// Discs therefore read the same archive through coarser tiles, whose edges cut few communes (about 2 % at zoom 9.5
// on the Rhône slice instead of a third at zoom 11); MapView keeps those tiles whole when overscaled. A cut commune
// can still show two identical discs side by side.
const MARKS_TILE_ZOOM = 8

export const NOTHING: FilterSpecification = ['==', ['get', 'code'], '']

export const LAYER_IDS = {
  departmentsFill: 'departments-fill',
  communesFill: 'communes-fill',
} as const

/** Layers that outline the selected place, per kind: tint, casing, then the amber line on top. */
export const SELECTION_LAYERS = {
  commune: ['communes-selected-tint', 'communes-selected-casing', 'communes-selected'],
  department: ['departments-selected-tint', 'departments-selected-casing', 'departments-selected'],
} as const

const NOTES: GeoJSONSourceSpecification['data'] = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { fr: 'Alsace-Moselle\nhors base DVF', en: 'Alsace-Moselle\noutside DVF' },
      geometry: { type: 'Point', coordinates: [7.3, 48.6] },
    },
  ],
}

function outlineLayers(sourceLayer: string, kind: keyof typeof SELECTION_LAYERS, zoom: { min?: number; max?: number }): LayerSpecification[] {
  const [tint, casing, line] = SELECTION_LAYERS[kind]
  const common = {
    source: 'data',
    'source-layer': sourceLayer,
    filter: NOTHING,
    ...(zoom.min === undefined ? {} : { minzoom: zoom.min }),
    ...(zoom.max === undefined ? {} : { maxzoom: zoom.max }),
  } as const
  return [
    { id: tint, type: 'fill', ...common, paint: { 'fill-color': PORCELAIN, 'fill-opacity': 0.16 } },
    { id: casing, type: 'line', ...common, paint: { 'line-color': GROUND, 'line-width': 6 } },
    { id: line, type: 'line', ...common, paint: { 'line-color': AMBER, 'line-width': 2.6 } },
  ]
}

function dataLayers(type: PriceType): LayerSpecification[] {
  const fill = priceFillExpression(type)
  const filters = patternFilters(type)
  const common = { source: 'data' } as const
  const patternLayer = (id: string, sourceLayer: string, pattern: string, rising: boolean, minzoom?: number, opacity?: ExpressionSpecification): LayerSpecification => ({
    id,
    type: 'fill',
    ...common,
    'source-layer': sourceLayer,
    ...(minzoom === undefined ? {} : { minzoom }),
    filter: filters[id],
    paint: { 'fill-pattern': pattern, 'fill-opacity': opacity ?? fade(0.94, rising) },
  })

  return [
    {
      id: LAYER_IDS.departmentsFill,
      type: 'fill',
      ...common,
      'source-layer': 'departments',
      maxzoom: FADE_TO,
      paint: { 'fill-color': fill, 'fill-opacity': fade(0.94, false) },
    },
    patternLayer('departments-nocoverage', 'departments', 'hatch-cross', false),
    {
      id: LAYER_IDS.communesFill,
      type: 'fill',
      ...common,
      'source-layer': 'communes',
      minzoom: FADE_FROM,
      paint: { 'fill-color': fill, 'fill-opacity': fade(0.94, true) },
    },
    patternLayer('communes-low-light', 'communes', 'hatch-low-light', true, FADE_FROM),
    patternLayer('communes-low-dark', 'communes', 'hatch-low-dark', true, FADE_FROM),
    patternLayer('communes-none', 'communes', 'dots', true, FADE_FROM),
    patternLayer('communes-nocoverage', 'communes', 'hatch-cross', true, FADE_FROM, ['interpolate', ['linear'], ['zoom'], 7, 0.75, 9, 0.35]),
    // Rough estimates on non-price themes (rents from few listings); hidden until such a theme is chosen.
    ...DOUBT_LAYERS.map(
      (id): LayerSpecification => ({
        id,
        type: 'fill',
        ...common,
        'source-layer': 'communes',
        minzoom: COMMUNES_FROM_TILE_ZOOM,
        filter: NOTHING,
        layout: { visibility: 'none' },
        paint: { 'fill-pattern': id === DOUBT_LAYERS[0] ? 'hatch-low-light' : 'hatch-low-dark', 'fill-opacity': 0.94 },
      }),
    ),
    {
      id: 'communes-dim',
      type: 'fill',
      ...common,
      'source-layer': 'communes',
      minzoom: FADE_FROM,
      filter: NOTHING,
      layout: { visibility: 'none' },
      paint: { 'fill-color': GROUND, 'fill-opacity': 0.84 },
    },
    {
      id: 'communes-line',
      type: 'line',
      ...common,
      'source-layer': 'communes',
      minzoom: 7.5,
      paint: {
        'line-color': PORCELAIN,
        'line-opacity': ['case', ['==', ['get', 'c_all'], 4], 0.05, 0.22],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7.5, 0.3, 12, 0.9],
      },
    },
    {
      id: 'departments-line',
      type: 'line',
      ...common,
      'source-layer': 'departments',
      maxzoom: 9,
      paint: { 'line-color': PORCELAIN, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 9, 0.15], 'line-width': 0.7 },
    },
    ...MARK_LAYERS.map((id): LayerSpecification => markLayer(id, id === MARK_LAYERS[1])),
    // After the discs, so a disc never covers the outline of the selected place.
    ...outlineLayers('departments', 'department', { max: FADE_TO }),
    ...outlineLayers('communes', 'commune', { min: FADE_FROM }),
  ]
}

function markLayer(id: string, everyCommune: boolean): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: 'marks',
    'source-layer': 'communes',
    ...(everyCommune ? { minzoom: MARKS_ALL_FROM } : { minzoom: COMMUNES_FROM_TILE_ZOOM, maxzoom: MARKS_ALL_FROM }),
    filter: NOTHING,
    layout: {
      visibility: 'none',
      'icon-image': markIcon(0, false),
      'icon-allow-overlap': everyCommune,
      'icon-ignore-placement': everyCommune,
      'icon-padding': 1,
    },
  }
}

export function buildStyle(tileUrl: string, type: PriceType, lang: Lang): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap',
      },
      data: {
        type: 'vector',
        url: `pmtiles://${tileUrl}`,
        attribution: '© IGN · DGFiP/Etalab · Licence Ouverte v2.0',
      },
      marks: { type: 'vector', url: `pmtiles://${tileUrl}`, maxzoom: MARKS_TILE_ZOOM },
      kmgrid: { type: 'geojson', data: new URL(kmGridUrl, window.location.href).href },
      notes: { type: 'geojson', data: NOTES },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': GROUND } },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': '#2FA36B', 'fill-opacity': 0.12 },
      },
      { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': '#12306A' } },
      {
        id: 'waterway',
        type: 'line',
        source: 'basemap',
        'source-layer': 'waterway',
        minzoom: 8,
        paint: { 'line-color': COBALT, 'line-opacity': 0.55, 'line-width': 0.7 },
      },
      ...dataLayers(type),
      {
        id: 'km-grid-100',
        type: 'line',
        source: 'kmgrid',
        minzoom: 3.5,
        filter: ['==', ['get', 'level'], 100],
        paint: { 'line-color': PORCELAIN, 'line-opacity': 0.2, 'line-width': 0.6 },
      },
      {
        id: 'km-grid-10',
        type: 'line',
        source: 'kmgrid',
        minzoom: 8,
        filter: ['==', ['get', 'level'], 10],
        paint: { 'line-color': PORCELAIN, 'line-opacity': 0.1, 'line-width': 0.5 },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: { 'line-color': '#C8642B', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.6] },
      },
      {
        id: 'country-border',
        type: 'line',
        source: 'basemap',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': PORCELAIN, 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [4, 2] },
      },
      ...placeLabels(),
      noteLabel(lang),
    ],
  }
}

export function noteLabel(lang: Lang): LayerSpecification {
  return {
    id: 'notes-label',
    type: 'symbol',
    source: 'notes',
    minzoom: 5,
    maxzoom: 9.5,
    layout: { 'text-field': ['get', lang], 'text-font': FONT, 'text-size': 12, 'text-max-width': 14, 'text-allow-overlap': true },
    paint: { 'text-color': PORCELAIN, 'text-halo-color': GROUND, 'text-halo-width': 1.6 },
  }
}

// Coarse outline of metropolitan France (a little outside the coast) used to tell French place names
// from foreign ones, which are drawn smaller and dimmer so they do not compete with the data.
const FRANCE_OUTLINE = {
  type: 'MultiPolygon' as const,
  coordinates: [
    [
      [
        [2.3, 51.35], [3.3, 51.0], [3.2, 50.7], [4.25, 50.3], [4.95, 50.2], [5.8, 49.55], [6.45, 49.55], [8.3, 49.15], [8.4, 48.9],
        [7.7, 47.9], [7.65, 47.55], [7.05, 47.45], [6.95, 47.2], [6.05, 46.35], [6.05, 46.15], [6.9, 46.0], [7.15, 45.7], [7.15, 45.1],
        [6.75, 44.2], [7.65, 43.85], [7.5, 43.5], [6.5, 43.0], [4.5, 43.2], [3.3, 42.95], [3.2, 42.35], [1.75, 42.35], [0.7, 42.7],
        [-0.8, 42.85], [-1.8, 43.35], [-1.55, 44.6], [-1.3, 46.0], [-2.4, 47.1], [-4.9, 47.9], [-5.1, 48.5], [-3.8, 48.9], [-1.9, 48.8],
        [-1.9, 49.7], [-1.0, 49.8], [0.2, 49.8], [1.6, 50.3], [2.3, 51.35],
      ],
    ],
    [[[8.35, 41.3], [9.7, 41.3], [9.7, 43.15], [8.9, 43.15], [8.35, 42.6], [8.35, 41.3]]],
  ],
}

const inFrance: ExpressionSpecification = ['within', FRANCE_OUTLINE as never]

// Neighbouring cities (London, Brussels, Geneva, Turin, Barcelona...) give context; farther ones only crop at the frame.
const NEIGHBOURHOOD = {
  type: 'Polygon' as const,
  coordinates: [[[-4.2, 41.2], [11.0, 41.2], [11.0, 52.0], [-4.2, 52.0], [-4.2, 41.2]]],
}
const nearFrance: ExpressionSpecification = ['within', NEIGHBOURHOOD as never]

// Fixed sizes per place rank (rank is carried by size and weight, not by zoom).
function placeLabels(): LayerSpecification[] {
  const label = (id: string, classes: string[], minzoom: number, size: number, font: string[], french: boolean): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    minzoom,
    filter: ['all', ['in', ['get', 'class'], ['literal', classes]], french ? inFrance : ['all', nearFrance, ['!', inFrance]]],
    layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': size, 'text-max-width': 8 },
    paint: {
      'text-color': PORCELAIN,
      'text-opacity': french ? 1 : 0.6,
      'text-halo-color': GROUND,
      'text-halo-width': 1.4,
    },
  })
  return [
    label('place-city', ['city'], 4.5, 15, FONT_BOLD, true),
    label('place-town', ['town'], 8, 13, FONT, true),
    label('place-village', ['village'], 10.5, 12, FONT, true),
    label('place-city-foreign', ['city'], 4.5, 11, FONT, false),
    label('place-town-foreign', ['town'], 8, 11, FONT, false),
  ]
}
