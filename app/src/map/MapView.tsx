import { GeoJSONSource, Map as MapLibreMap, NavigationControl, addProtocol, setWorkerUrl, type MapGeoJSONFeature, type PointLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { PMTiles, Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics/track'
import { type OverlaysManifest, overlaysTileUrl, tileUrl } from '../data/manifest'
import { tileFieldsOf } from '../domain/layers'
import { type PlaceSelection, readPlaceFeature } from '../domain/overlays'
import { initialState, useAppStore } from '../state/appStore'
import type { Manifest } from '../state/store'
import { formatHash } from '../state/urlState'
import { registerPatterns } from './patterns'
import { registerPlaceIcons } from './placeIcons'
import { SheetScale, attachSheetFrame } from './sheetFrame'
import { applyAppearance, applyOverlays } from './appearance'
import { COMMUNES_FROM_TILE_ZOOM, LAYER_IDS, PLACE_LAYERS, PLACE_SELECTION, SELECTION_LAYERS, buildStyle, placeSelectionData } from './style'

let protocol: Protocol | null = null
function registerProtocol(): Protocol {
  if (protocol) return protocol
  // MapLibre 6 starts a module worker from a URL the bundler does not emit on its own.
  setWorkerUrl(workerUrl)
  protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  return protocol
}

/**
 * Tells the store which properties the communes tiles carry, so themes and filters the data lacks are not offered.
 * The archive is shared with the map's protocol, so its header and metadata are fetched once. On failure every
 * layer stays offered, as before.
 */
function readTileFields(url: string, onFields: (fields: ReturnType<typeof tileFieldsOf>) => void) {
  const archive = new PMTiles(url)
  registerProtocol().add(archive)
  archive.getMetadata().then(
    (metadata) => onFields(tileFieldsOf(metadata)),
    (error: unknown) => console.warn('Tile metadata unavailable:', error),
  )
}

const COMMUNE_ZOOM = 6.5
const MAX_ZOOM = 15
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const WIDE_SCREEN = '(min-width: 720px)'
const METROPOLITAN_FRANCE: [[number, number], [number, number]] = [[-5.6, 41.0], [10.0, 51.3]]

type Picked = { kind: 'commune' | 'department'; feature: MapGeoJSONFeature }

function pickFeature(map: MapLibreMap, point: PointLike): Picked | null {
  const features = map.queryRenderedFeatures(point, { layers: [LAYER_IDS.communesFill, LAYER_IDS.departmentsFill] })
  const pick = (kind: Picked['kind'], layerId: string): Picked | null => {
    const feature = features.find((candidate) => candidate.layer.id === layerId)
    return feature ? { kind, feature } : null
  }
  const commune = pick('commune', LAYER_IDS.communesFill)
  const department = pick('department', LAYER_IDS.departmentsFill)
  return map.getZoom() >= COMMUNE_ZOOM ? (commune ?? department) : (department ?? commune)
}

// How far from the click a dot still counts as clicked; a fingertip is less exact than a pointer.
const PICK_RADIUS = { fine: 10, coarse: 18 } as const

/** The place dot or badge nearest to a point within a few pixels, whatever the commune beneath it. */
function pickPlace(map: MapLibreMap, point: { x: number; y: number }): PlaceSelection | null {
  const layers = Object.values(PLACE_LAYERS).filter((id) => map.getLayer(id))
  if (layers.length === 0) return null
  const radius = matchMedia('(pointer: coarse)').matches ? PICK_RADIUS.coarse : PICK_RADIUS.fine
  const features = map.queryRenderedFeatures([[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]], { layers })
  const places = features.flatMap((feature) => {
    const place = feature.geometry.type === 'Point' ? readPlaceFeature(feature.properties, feature.geometry.coordinates[0], feature.geometry.coordinates[1]) : null
    if (!place) return []
    const shown = map.project([place.lng, place.lat])
    return [{ place, distance: Math.hypot(shown.x - point.x, shown.y - point.y) }]
  })
  return places.sort((a, b) => a.distance - b.distance)[0]?.place ?? null
}

function resolveCommune(map: MapLibreMap, code: string): Record<string, unknown> | null {
  const [feature] = map.querySourceFeatures('data', { sourceLayer: 'communes', filter: ['==', ['get', 'code'], code] })
  return feature ? { ...feature.properties } : null
}

// With no view in the URL, show all of metropolitan France (Corsica included) whatever the screen shape,
// keeping clear of the side panels on wide screens and of the legend strip on phones. The sheet margin leaves a phone
// map narrower than the screen, so the fit alone lands just under COMMUNES_FROM_TILE_ZOOM; see keepCommunesVisible.
function nationalView() {
  const wide = matchMedia(WIDE_SCREEN).matches
  return {
    bounds: METROPOLITAN_FRANCE,
    fitBoundsOptions: wide
      ? { padding: { top: 16, bottom: 16, left: 320, right: 340 } }
      : { padding: { top: 8, bottom: 96, left: 8, right: 8 } },
  }
}

// Every theme but the price ones draws the communes layer only, which has no tiles below COMMUNES_FROM_TILE_ZOOM.
// On a 360 px phone the exact fit needs zoom 3.85; staying at 4 keeps the whole country in view with Corsica and
// Ushant touching the edges.
function keepCommunesVisible(map: MapLibreMap) {
  if (map.getZoom() < COMMUNES_FROM_TILE_ZOOM) map.setZoom(COMMUNES_FROM_TILE_ZOOM)
}

export interface MapViewProps {
  manifest: Manifest
  /** The overlays archive; null when there is none, so the map has no places and no seismic lines. */
  overlays: OverlaysManifest | null
}

export function MapView({ manifest, overlays }: MapViewProps) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const store = useAppStore
    readTileFields(tileUrl(manifest), (fields) => store.getState().setTileFields(fields))
    const initial = store.getState()

    const map = new MapLibreMap({
      container: element,
      style: buildStyle(tileUrl(manifest), initial.priceType, initial.lang, overlays ? overlaysTileUrl(overlays) : undefined),
      ...(initialState.viewProvided ? { center: [initialState.lng, initialState.lat], zoom: initialState.zoom } : nationalView()),
      minZoom: 3.5,
      maxZoom: MAX_ZOOM,
      // Overscaled tiles are not cut into smaller ones: each cut would place one more disc per commune it crosses.
      zoomLevelsToOverscale: MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
      // Three device pixels per CSS pixel triples the fill cost on phones for no visible gain on flat colour fills.
      pixelRatio: Math.min(window.devicePixelRatio || 1, matchMedia(WIDE_SCREEN).matches ? 3 : 2),
      hash: false,
    })
    if (!initialState.viewProvided) keepCommunesVisible(map)
    // The compact attribution opens by default once the sources name themselves, covering the map on phones and
    // shifting the controls above it; marking it compact while still empty keeps it closed from the first frame.
    // Users can still open it.
    element.querySelector('.maplibregl-ctrl-attrib')?.classList.add('maplibregl-compact')
    map.touchZoomRotate.disableRotation()
    map.touchPitch.disable()
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new SheetScale(), 'bottom-right')
    const detachFrame = element.parentElement ? attachSheetFrame(map, element.parentElement) : () => undefined
    registerPatterns(map)
    registerPlaceIcons(map)
    if (import.meta.env.DEV) (window as unknown as { __map: MapLibreMap }).__map = map

    const syncHash = () => {
      const center = map.getCenter()
      const state = store.getState()
      history.replaceState(
        null,
        '',
        formatHash({
          lng: center.lng,
          lat: center.lat,
          zoom: map.getZoom(),
          type: state.priceType,
          selected: state.selection ? String(state.selection.props.code ?? '') || null : null,
          theme: state.theme,
          compare: state.compare,
          mix: state.mix,
          filters: state.filters,
          overlays: state.overlays,
        }),
      )
    }

    const showSelection = (selection: ReturnType<typeof store.getState>['selection']) => {
      const code = selection ? String(selection.props.code ?? '') : ''
      for (const [kind, layers] of Object.entries(SELECTION_LAYERS)) {
        for (const id of layers) map.setFilter(id, ['==', ['get', 'code'], selection?.kind === kind ? code : ''])
      }
    }

    const showPlace = (place: ReturnType<typeof store.getState>['placeSelection']) => {
      const ring = map.getSource(PLACE_SELECTION.source)
      if (ring instanceof GeoJSONSource) ring.setData(placeSelectionData(place))
    }

    // Paris, Lyon and Marseille exist only as arrondissements in the tiles, so a search
    // for their parent code falls back to the arrondissement under the map centre.
    const resolvePending = (fallbackToCentre: boolean) => {
      const code = store.getState().pendingCode
      if (!code) return
      const props = resolveCommune(map, code)
      if (props) return store.getState().select({ kind: 'commune', props })
      const picked = fallbackToCentre ? pickFeature(map, map.project(map.getCenter())) : null
      if (picked) store.getState().select({ kind: picked.kind, props: { ...picked.feature.properties } })
    }

    // Style changes are allowed once the style has loaded, tiles still arriving or not (`isStyleLoaded` also waits for
    // them, and a theme chosen meanwhile would then never reach the map).
    let styleLoaded = false
    map.on('load', () => {
      styleLoaded = true
      applyAppearance(map, store.getState())
      applyOverlays(map, store.getState().overlays)
      store.getState().setMapStatus('ready')
      map.once('idle', () => resolvePending(false))
      syncHash()
    })
    map.on('error', (event) => {
      console.error('Map error:', event.error?.message ?? event)
      if (store.getState().mapStatus === 'loading' && (event as { sourceId?: string }).sourceId === 'data') {
        store.getState().setMapStatus('error')
        track('map_error')
      }
    })
    map.on('moveend', syncHash)
    map.on('click', (event) => {
      const place = pickPlace(map, event.point)
      if (place) {
        store.getState().selectPlace(place)
        return
      }
      if (store.getState().placeSelection) store.getState().selectPlace(null)
      const picked = pickFeature(map, event.point)
      store.getState().select(picked ? { kind: picked.kind, props: { ...picked.feature.properties } } : null)
    })
    // Pointer cursor over a place: only where hovering exists, at most once per frame, and not while the map is moving.
    if (matchMedia('(hover: hover)').matches) {
      let hoverFrame = 0
      map.on('mousemove', (event) => {
        if (hoverFrame || map.isMoving()) return
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0
          map.getCanvas().style.cursor = pickPlace(map, event.point) || pickFeature(map, event.point) ? 'pointer' : ''
        })
      })
    }

    const unsubscribe = store.subscribe((state, previous) => {
      const appearanceChanged = (['priceType', 'theme', 'compare', 'mix', 'filters'] as const).some((key) => state[key] !== previous[key])
      const overlaysChanged = state.overlays !== previous.overlays
      if (appearanceChanged && styleLoaded) applyAppearance(map, state)
      if (overlaysChanged && styleLoaded) applyOverlays(map, state.overlays)
      if (state.selection !== previous.selection) showSelection(state.selection)
      if (state.placeSelection !== previous.placeSelection) showPlace(state.placeSelection)
      if (appearanceChanged || overlaysChanged || state.selection !== previous.selection) syncHash()
      const request = state.flyRequest
      if (request && request !== previous.flyRequest) {
        map.flyTo({ center: [request.lng, request.lat], zoom: request.zoom, essential: true, animate: !matchMedia(REDUCED_MOTION).matches })
        map.once('idle', () => resolvePending(true))
      }
    })

    return () => {
      unsubscribe()
      detachFrame()
      map.remove()
    }
  }, [manifest, overlays])

  return <div ref={container} className="map" role="region" aria-label={t('status.mapLabel')} />
}
