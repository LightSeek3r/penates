import { type StylePropertySpecification, createExpression, featureFilter, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLACE_KINDS, RISK_FROM_ZOOM, RISK_LINES, RISK_OVERLAYS, RISK_STYLE, SEISMIC_LEVELS, type OverlayId, type PlaceKindId, riskLevels } from '../domain/overlays'
import { HATCH_INK_DARK } from '../domain/priceLadder'
import { applyOverlays } from './appearance'
import { GROUND, PLACE_LAYERS, PLACE_SELECTION, SELECTION_LAYERS, buildStyle, overlayLayers, placeSelectionData, riskLayerIds } from './style'

const ARCHIVE = 'https://data.example/v1/overlays.pmtiles'
const AMBER = '#F2A81D'
// The four risks that share the `risk` layer of the archive, told apart by `r`.
const RISK_LINE_IDS = Object.keys(RISK_LINES) as (keyof typeof RISK_LINES)[]

// buildStyle resolves the kilometre grid against the page URL.
beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } })
})
afterEach(() => vi.unstubAllGlobals())

const styleWith = (archive?: string): StyleSpecification => buildStyle('https://data.example/communes.pmtiles', 'all', 'fr', archive)
const idsOf = (style: StyleSpecification) => style.layers.map((layer) => layer.id)
const layerOf = (style: StyleSpecification, id: string): LayerSpecification => {
  const found = style.layers.find((layer) => layer.id === id)
  if (!found) throw new Error(`No layer ${id}`)
  return found
}
const paintOf = (layer: LayerSpecification) => (layer as { paint?: Record<string, unknown> }).paint ?? {}
const layoutOf = (layer: LayerSpecification) => (layer as { layout?: Record<string, unknown> }).layout ?? {}
const filterOf = (style: StyleSpecification, id: string) => (layerOf(style, id) as { filter?: unknown }).filter

/** Evaluates a data-driven paint or layout value the way MapLibre does, so a malformed expression fails here. */
function evaluate(expression: unknown, spec: object, properties: Record<string, unknown>, zoom = 8): unknown {
  // deliberate: the bundled spec JSON is typed loosely; createExpression reads only its type and expression fields.
  const parsed = createExpression(expression, 'test', spec as StylePropertySpecification)
  if (parsed.result !== 'success') throw new Error(parsed.value.map((error) => error.message).join('; '))
  return parsed.value.evaluate({ zoom }, { type: 1, properties } as never)
}
const lineWidth = (id: string, properties: Record<string, unknown>, zoom?: number) => evaluate(paintOf(layerOf(styleWith(ARCHIVE), id))['line-width'], latest.paint_line['line-width'], properties, zoom) as number
const passes = (filter: unknown, properties: Record<string, unknown>) => featureFilter(filter as never, 'test').filter({ zoom: 9 }, { type: 1, properties } as never)

describe('overlay layers in the style', () => {
  it('form a valid style with the archive, and without it', () => {
    for (const style of [styleWith(ARCHIVE), styleWith()]) {
      const errors = validateStyleMin(style as never).map((error) => error.message)
      expect(errors).toEqual([])
    }
  })

  it('add the overlays source only when the archive exists, and never leave a layer pointing at a missing source', () => {
    expect(styleWith(ARCHIVE).sources.overlays).toMatchObject({ type: 'vector', url: `pmtiles://${ARCHIVE}`, attribution: expect.stringContaining('Géorisques') })
    const bare = styleWith()
    expect(bare.sources.overlays).toBeUndefined()
    expect(bare.sources[PLACE_SELECTION.source]).toBeUndefined()
    for (const layer of bare.layers) if ('source' in layer) expect(Object.keys(bare.sources), layer.id).toContain(layer.source)
    expect(idsOf(bare).filter((id) => id.startsWith('overlay-') || id.startsWith('place-selected'))).toEqual([])
  })

  it('draw over the boundaries and discs, under the selection outline, the kilometre grid, roads and names', () => {
    const ids = idsOf(styleWith(ARCHIVE))
    const overlay = ids.flatMap((id, index) => (id.startsWith('overlay-') ? [index] : []))
    const first = Math.min(...overlay)
    const last = Math.max(...overlay)
    for (const below of ['communes-line', 'departments-line', 'communes-marks-thinned', 'communes-marks']) expect(ids.indexOf(below), below).toBeLessThan(first)
    for (const above of [...SELECTION_LAYERS.commune, ...SELECTION_LAYERS.department, 'km-grid-100', 'roads-major', 'place-city', 'place-village']) expect(ids.indexOf(above), above).toBeGreaterThan(last)
    // One block, with the places over the lines and the seismic lines over the other risks.
    expect(overlay).toEqual(Array.from({ length: overlay.length }, (_, index) => first + index))
    expect(ids.indexOf(PLACE_LAYERS.dot)).toBeGreaterThan(ids.indexOf('overlay-seismic'))
    expect(ids.indexOf('overlay-seismic-casing')).toBeGreaterThan(ids.indexOf('overlay-cavities'))
  })

  it('draw every casing right under its ink', () => {
    const ids = idsOf(styleWith(ARCHIVE))
    for (const id of RISK_OVERLAYS) {
      const [casing, ink] = riskLayerIds(id)
      expect(ids.indexOf(ink), id).toBe(ids.indexOf(casing) + 1)
    }
  })

  it('start hidden, and the dots start filtered to nothing', () => {
    const style = styleWith(ARCHIVE)
    for (const layer of overlayLayers()) expect(layoutOf(layer).visibility, layer.id).toBe('none')
    for (const id of Object.values(PLACE_LAYERS)) expect(passes(filterOf(style, id), { k: 'hos' }), id).toBe(false)
  })

  it('pair a midnight casing with an ink drawn from RISK_STYLE, the casing wider and solid', () => {
    const style = styleWith(ARCHIVE)
    for (const id of RISK_OVERLAYS) {
      const [casing, ink] = riskLayerIds(id).map((layerId) => layerOf(style, layerId))
      expect(paintOf(casing)['line-color'], id).toBe(GROUND)
      expect(GROUND).toBe(HATCH_INK_DARK)
      expect(paintOf(ink)['line-color'], id).toBe(RISK_STYLE[id].ink)
      expect(paintOf(casing)['line-dasharray'], id).toBeUndefined()
      expect(paintOf(ink)['line-dasharray'], id).toEqual(RISK_STYLE[id].dash)
      expect(layoutOf(ink)['line-join']).toBe('round')
    }
  })

  it('read every risk from the overlays archive: the seismic lines from their layer, the others from `risk`', () => {
    const style = styleWith(ARCHIVE)
    for (const id of riskLayerIds('seismic')) expect(layerOf(style, id)).toMatchObject({ source: 'overlays', 'source-layer': 'seismic' })
    for (const risk of RISK_LINE_IDS) {
      for (const id of riskLayerIds(risk)) expect(layerOf(style, id), id).toMatchObject({ source: 'overlays', 'source-layer': 'risk' })
    }
    // Nothing of the risks is drawn from the communes tiles any more.
    for (const layer of style.layers.filter((entry) => entry.id.startsWith('overlay-'))) expect(layer, layer.id).toMatchObject({ source: 'overlays' })
  })

  it('draw a risk line from the zoom set for it (every zoom the tiles hold when none), never past the last, and fully opaque', () => {
    const style = styleWith(ARCHIVE)
    for (const id of RISK_OVERLAYS) {
      for (const layerId of riskLayerIds(id)) {
        const from = RISK_FROM_ZOOM[id]
        if (from === undefined) expect(layerOf(style, layerId), layerId).not.toHaveProperty('minzoom')
        else expect(layerOf(style, layerId), layerId).toHaveProperty('minzoom', from)
        expect(layerOf(style, layerId), layerId).not.toHaveProperty('maxzoom')
        expect(paintOf(layerOf(style, layerId))['line-opacity'], layerId).toBeUndefined()
      }
    }
  })

  it('pick the lines of one risk by the `r` property, and the seismic lines by their own layer', () => {
    const style = styleWith(ARCHIVE)
    for (const risk of RISK_LINE_IDS) {
      for (const layerId of riskLayerIds(risk)) {
        for (const other of RISK_LINE_IDS) expect(passes(filterOf(style, layerId), { r: other, z: 1 }), `${layerId} sees ${other}`).toBe(other === risk)
        expect(passes(filterOf(style, layerId), { z: 1 }), `${layerId} without r`).toBe(false)
      }
    }
    for (const layerId of riskLayerIds('seismic')) expect(filterOf(style, layerId), layerId).toBeUndefined()
  })

  it('widen the seismic lines with the zone, for the ink and for the casing', () => {
    SEISMIC_LEVELS.forEach((level, index) => {
      expect(lineWidth('overlay-seismic', { z: level })).toBeCloseTo(RISK_STYLE.seismic.widths[index], 2)
      expect(lineWidth('overlay-seismic-casing', { z: level })).toBeCloseTo(RISK_STYLE.seismic.widths[index] + 2, 2)
    })
    const widths = SEISMIC_LEVELS.map((level) => lineWidth('overlay-seismic', { z: level }))
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  })

  it('widen every other risk line with its level, for the ink and for the casing: three levels, radon two', () => {
    for (const id of RISK_LINE_IDS) {
      riskLevels(id).forEach((level, index) => {
        expect(lineWidth(`overlay-${id}`, { r: id, z: level }), `${id} ${level}`).toBeCloseTo(RISK_STYLE[id].widths[index], 2)
        expect(lineWidth(`overlay-${id}-casing`, { r: id, z: level }), `${id} ${level} casing`).toBeCloseTo(RISK_STYLE[id].widths[index] + 2, 2)
      })
    }
    expect(RISK_LINE_IDS.map((id) => riskLevels(id).length)).toEqual([3, 3, 2, 3])
    // Cavities: the line where the count reaches 1, then 5, then 25.
    expect([1, 5, 25].map((count) => lineWidth('overlay-cavities', { r: 'cavities', z: count }))).toEqual([1.4, 2, 2.8])
    // A level the style does not know falls back to the finest line rather than failing.
    expect(lineWidth('overlay-flood', { r: 'flood', z: 9 })).toBeCloseTo(RISK_STYLE.flood.widths[0], 2)
  })

  it('scale line widths with the zoom, thinner from far away and heavier up close', () => {
    for (const [layer, properties] of [['overlay-seismic', { z: 3 }], ['overlay-flood', { r: 'flood', z: 2 }]] as const) {
      expect(lineWidth(layer, properties, 4), layer).toBeLessThan(lineWidth(layer, properties, 8))
      expect(lineWidth(layer, properties, 12), layer).toBeGreaterThan(lineWidth(layer, properties, 8))
    }
  })

  it('draw a symbol per kind, a dot up to zoom 12 and a pictogram badge from it, over any other symbol', () => {
    const style = styleWith(ARCHIVE)
    const dot = layerOf(style, PLACE_LAYERS.dot)
    const glyph = layerOf(style, PLACE_LAYERS.glyph)
    expect(dot).toMatchObject({ type: 'symbol', source: 'overlays', 'source-layer': 'places', maxzoom: 12 })
    expect(glyph).toMatchObject({ type: 'symbol', source: 'overlays', 'source-layer': 'places', minzoom: 12 })
    for (const layer of [dot, glyph]) {
      expect(layoutOf(layer)['icon-allow-overlap']).toBe(true)
      expect(layoutOf(layer)['icon-ignore-placement']).toBe(true)
    }
    const image = (layer: LayerSpecification, k: string) => evaluate(layoutOf(layer)['icon-image'], latest.layout_symbol['icon-image'], { k })
    for (const { id } of PLACE_KINDS) {
      expect(String(image(dot, id))).toBe(`place-dot-${id}`)
      expect(String(image(glyph, id))).toBe(`place-glyph-${id}`)
    }
  })
})

describe('applyOverlays', () => {
  function fakeMap(layerIds: readonly string[]) {
    const visibility: Record<string, unknown> = {}
    const filters: Record<string, unknown> = {}
    const touched: string[] = []
    const map = {
      getLayer: (id: string) => (layerIds.includes(id) ? { id } : undefined),
      setLayoutProperty: (id: string, property: string, value: unknown) => {
        touched.push(id)
        if (property === 'visibility') visibility[id] = value
      },
      setFilter: (id: string, filter: unknown) => {
        touched.push(id)
        filters[id] = filter
      },
    } as unknown as MapLibreMap
    return { map, visibility, filters, touched }
  }
  const allIds = () => overlayLayers().map((layer) => layer.id)
  const kindsShown = (filter: unknown) => PLACE_KINDS.filter(({ id }) => passes(filter, { k: id })).map(({ id }) => id)

  it('shows the lines of the overlays that are on and the kinds that are on, nothing else', () => {
    const { map, visibility, filters } = fakeMap(allIds())
    applyOverlays(map, ['seismic', 'clay', 'hos', 'pool'])
    for (const id of RISK_OVERLAYS) for (const layer of riskLayerIds(id)) expect(visibility[layer], layer).toBe(['seismic', 'clay'].includes(id) ? 'visible' : 'none')
    for (const layer of Object.values(PLACE_LAYERS)) {
      expect(visibility[layer], layer).toBe('visible')
      expect(kindsShown(filters[layer]), layer).toEqual(['hos', 'pool'])
    }
  })

  it('hides every overlay layer and filters the places to nothing when none is on', () => {
    const { map, visibility, filters } = fakeMap(allIds())
    applyOverlays(map, ['hos'])
    applyOverlays(map, [])
    for (const layer of allIds()) expect(visibility[layer], layer).toBe('none')
    for (const layer of Object.values(PLACE_LAYERS)) expect(kindsShown(filters[layer]), layer).toEqual([])
  })

  it('keeps the kinds it shows in step with the list, one at a time', () => {
    const { map, filters } = fakeMap(allIds())
    const picks: PlaceKindId[][] = [['hos'], ['hos', 'gp'], ['gp'], ['lib', 'cin', 'sta']]
    for (const kinds of picks) {
      applyOverlays(map, kinds as OverlayId[])
      expect(kindsShown(filters[PLACE_LAYERS.dot])).toEqual(PLACE_KINDS.map((kind) => kind.id).filter((id) => kinds.includes(id)))
    }
  })

  it('skips layers the style lacks, as when there is no overlays archive', () => {
    const { map, touched } = fakeMap([])
    expect(() => applyOverlays(map, ['seismic', 'flood', 'hos'])).not.toThrow()
    expect(touched).toEqual([])
  })

  it('shows the layers of a style that has only some of the risks', () => {
    const present: readonly string[] = riskLayerIds('flood')
    const { map, visibility, touched } = fakeMap(present)
    applyOverlays(map, ['seismic', 'flood', 'hos'])
    expect(visibility).toEqual({ 'overlay-flood-casing': 'visible', 'overlay-flood': 'visible' })
    expect(touched.every((id) => present.includes(id))).toBe(true)
  })
})

describe('the ring around the picked place', () => {
  it('has its own empty GeoJSON source and two circle layers, over every overlay and selection layer, under the labels', () => {
    const style = styleWith(ARCHIVE)
    expect(style.sources[PLACE_SELECTION.source]).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const ids = idsOf(style)
    for (const id of [PLACE_SELECTION.casing, PLACE_SELECTION.ring]) {
      expect(layerOf(style, id)).toMatchObject({ type: 'circle', source: PLACE_SELECTION.source })
      for (const below of [...Object.values(PLACE_LAYERS), ...SELECTION_LAYERS.commune, ...SELECTION_LAYERS.department]) expect(ids.indexOf(id), `${id} over ${below}`).toBeGreaterThan(ids.indexOf(below))
      for (const above of ['km-grid-100', 'roads-major', 'place-city']) expect(ids.indexOf(id), `${id} under ${above}`).toBeLessThan(ids.indexOf(above))
    }
    expect(ids.indexOf(PLACE_SELECTION.ring)).toBe(ids.indexOf(PLACE_SELECTION.casing) + 1)
  })

  it('is a hollow amber ring on a midnight casing, wider than the dot at every zoom and than the badge from zoom 12', () => {
    const style = styleWith(ARCHIVE)
    const ring = paintOf(layerOf(style, PLACE_SELECTION.ring))
    const casing = paintOf(layerOf(style, PLACE_SELECTION.casing))
    expect(ring['circle-stroke-color']).toBe(AMBER)
    expect(casing['circle-stroke-color']).toBe(GROUND)
    expect(ring['circle-opacity']).toBe(0)
    expect(casing['circle-stroke-width'] as number).toBeGreaterThan(ring['circle-stroke-width'] as number)
    const radius = (zoom: number) => evaluate(ring['circle-radius'], latest.paint_circle['circle-radius'], {}, zoom) as number
    // The dot's casing is 6px across the radius, the badge's 13px.
    expect(radius(8)).toBeGreaterThan(6)
    expect(radius(11.9)).toBeGreaterThan(6)
    expect(radius(12)).toBeGreaterThan(13)
  })

  it('holds the picked dot alone, and nothing when no dot is picked', () => {
    expect(placeSelectionData(null)).toEqual({ type: 'FeatureCollection', features: [] })
    expect(placeSelectionData({ lng: 4.84, lat: 45.74 }).features).toEqual([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [4.84, 45.74] } }])
  })
})
