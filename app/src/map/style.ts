import type { ExpressionSpecification, FilterSpecification, GeoJSONSourceSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { PriceType } from '../domain/place'
import { priceFillExpression } from '../domain/priceLadder'

export const GROUND = '#0B1B3A'
const PORCELAIN = '#F4F7FB'
const COBALT = '#2F6FDB'
const AMBER = '#F2A81D'
const FONT = ['Noto Sans Regular']

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

export const confidenceFilter = (type: PriceType, value: number): FilterSpecification => ['==', ['get', `c_${type}`], value]

export const LAYER_IDS = {
  departmentsFill: 'departments-fill',
  communesFill: 'communes-fill',
  departmentsSelected: 'departments-selected',
  communesSelected: 'communes-selected',
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

function dataLayers(type: PriceType): LayerSpecification[] {
  const fill = priceFillExpression(type)
  const common = { source: 'data' } as const
  const patternLayer = (id: string, sourceLayer: string, value: number, pattern: string, rising: boolean, minzoom?: number): LayerSpecification => ({
    id,
    type: 'fill',
    ...common,
    'source-layer': sourceLayer,
    ...(minzoom === undefined ? {} : { minzoom }),
    filter: confidenceFilter(type, value),
    paint: { 'fill-pattern': pattern, 'fill-opacity': fade(0.9, rising) },
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
    patternLayer('departments-nocoverage', 'departments', 4, 'hatch-cross', false),
    {
      id: LAYER_IDS.communesFill,
      type: 'fill',
      ...common,
      'source-layer': 'communes',
      minzoom: FADE_FROM,
      paint: { 'fill-color': fill, 'fill-opacity': fade(0.94, true) },
    },
    patternLayer('communes-low', 'communes', 1, 'hatch-low', true, FADE_FROM),
    patternLayer('communes-none', 'communes', 0, 'dots', true, FADE_FROM),
    patternLayer('communes-nocoverage', 'communes', 4, 'hatch-cross', true, FADE_FROM),
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
    {
      id: LAYER_IDS.departmentsSelected,
      type: 'line',
      ...common,
      'source-layer': 'departments',
      maxzoom: FADE_TO,
      filter: ['==', ['get', 'code'], ''],
      paint: { 'line-color': AMBER, 'line-width': 2.5 },
    },
    {
      id: LAYER_IDS.communesSelected,
      type: 'line',
      ...common,
      'source-layer': 'communes',
      minzoom: FADE_FROM,
      filter: ['==', ['get', 'code'], ''],
      paint: { 'line-color': AMBER, 'line-width': 2.5 },
    },
  ]
}

export function buildStyle(tileUrl: string, type: PriceType): StyleSpecification {
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
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': COBALT, 'line-opacity': 0.22, 'line-width': 0.5 } },
      ...dataLayers(type),
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
    ],
  }
}

function placeLabels(): LayerSpecification[] {
  const label = (id: string, classes: string[], minzoom: number, size: [number, number]): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'place',
    minzoom,
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, size[0], 14, size[1]],
      'text-max-width': 8,
    },
    paint: { 'text-color': PORCELAIN, 'text-halo-color': GROUND, 'text-halo-width': 1.4 },
  })
  return [label('place-city', ['city'], 4.5, [11, 17]), label('place-town', ['town'], 8, [11, 15]), label('place-village', ['village'], 10.5, [10, 13])]
}
