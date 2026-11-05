import type { ExpressionSpecification, FilterSpecification, GeoJSONSourceSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { PriceType } from '../domain/place'
import { HATCH_LIGHT_BELOW, priceFillExpression } from '../domain/priceLadder'
import type { Lang } from '../state/urlState'

export const GROUND = '#0B1B3A'
const PORCELAIN = '#F4F7FB'
const COBALT = '#2F6FDB'
const AMBER = '#F2A81D'
const FONT = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

// Departments carry the picture up to the cross-fade; communes take over from here.
const FADE_FROM = 6
const FADE_TO = 7

const fade = (opacity: number, rising: boolean): ExpressionSpecification => [
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

export const LAYER_IDS = {
  departmentsFill: 'departments-fill',
  communesFill: 'communes-fill',
} as const

/** Layers that outline the selected place, per kind: tint, casing, then the amber line on top. */
export const SELECTION_LAYERS = {
  commune: ['communes-selected-tint', 'communes-selected-casing', 'communes-selected'],
  department: ['departments-selected-tint', 'departments-selected-casing', 'departments-selected'],
} as const

function graticule(): GeoJSONSourceSpecification['data'] {
  const line = (a: [number, number], b: [number, number]) => ({
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: [a, b] },
  })
  const meridians = Array.from({ length: 17 }, (_, i) => line([-6 + i, 40], [-6 + i, 52]))
  const parallels = Array.from({ length: 11 }, (_, i) => line([-7, 41 + i], [11, 41 + i]))
  return { type: 'FeatureCollection', features: [...meridians, ...parallels] }
}

const NOTES: GeoJSONSourceSpecification['data'] = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { fr: 'Alsace-Moselle : hors base DVF', en: 'Alsace-Moselle: outside DVF' },
      geometry: { type: 'Point', coordinates: [7.0, 48.62] },
    },
  ],
}

function outlineLayers(sourceLayer: string, kind: keyof typeof SELECTION_LAYERS, zoom: { min?: number; max?: number }): LayerSpecification[] {
  const [tint, casing, line] = SELECTION_LAYERS[kind]
  const common = {
    source: 'data',
    'source-layer': sourceLayer,
    filter: ['==', ['get', 'code'], ''] as FilterSpecification,
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
  const patternLayer = (id: string, sourceLayer: string, pattern: string, rising: boolean, minzoom?: number): LayerSpecification => ({
    id,
    type: 'fill',
    ...common,
    'source-layer': sourceLayer,
    ...(minzoom === undefined ? {} : { minzoom }),
    filter: filters[id],
    paint: { 'fill-pattern': pattern, 'fill-opacity': fade(0.94, rising) },
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
    patternLayer('communes-nocoverage', 'communes', 'hatch-cross', true, FADE_FROM),
    {
      id: 'communes-line',
      type: 'line',
      ...common,
      'source-layer': 'communes',
      minzoom: 7.5,
      paint: { 'line-color': PORCELAIN, 'line-opacity': 0.22, 'line-width': ['interpolate', ['linear'], ['zoom'], 7.5, 0.3, 12, 0.9] },
    },
    {
      id: 'departments-line',
      type: 'line',
      ...common,
      'source-layer': 'departments',
      maxzoom: 9,
      paint: { 'line-color': PORCELAIN, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 9, 0.15], 'line-width': 0.7 },
    },
    ...outlineLayers('departments', 'department', { max: FADE_TO }),
    ...outlineLayers('communes', 'commune', { min: FADE_FROM }),
  ]
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
      graticule: { type: 'geojson', data: graticule() },
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
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': PORCELAIN, 'line-opacity': 0.13, 'line-width': 0.6 } },
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
    layout: { 'text-field': ['get', lang], 'text-font': FONT, 'text-size': 12, 'text-max-width': 8, 'text-allow-overlap': true },
    paint: { 'text-color': PORCELAIN, 'text-halo-color': GROUND, 'text-halo-width': 1.6 },
  }
}

// Fixed sizes per place rank (rank is carried by size and weight, not by zoom).
function placeLabels(): LayerSpecification[] {
  const label = (id: string, classes: string[], minzoom: number, size: number, font: string[]): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    minzoom,
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': size, 'text-max-width': 8 },
    paint: { 'text-color': PORCELAIN, 'text-halo-color': GROUND, 'text-halo-width': 1.4 },
  })
  return [
    label('place-city', ['city'], 4.5, 15, FONT_BOLD),
    label('place-town', ['town'], 8, 13, FONT),
    label('place-village', ['village'], 10.5, 12, FONT),
  ]
}
