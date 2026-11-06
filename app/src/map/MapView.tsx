import { Map as MapLibreMap, NavigationControl, addProtocol, setWorkerUrl, type MapGeoJSONFeature, type PointLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './map.css'
import { PMTiles, Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics/track'
import { tileUrl } from '../data/manifest'
import { tileFieldsOf } from '../domain/layers'
import { initialState, useAppStore } from '../state/appStore'
import type { Manifest } from '../state/store'
import { formatHash } from '../state/urlState'
import { registerPatterns } from './patterns'
import { SheetScale, attachSheetFrame } from './sheetFrame'
import { applyAppearance } from './appearance'
import { LAYER_IDS, SELECTION_LAYERS, buildStyle } from './style'

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

function resolveCommune(map: MapLibreMap, code: string): Record<string, unknown> | null {
  const [feature] = map.querySourceFeatures('data', { sourceLayer: 'communes', filter: ['==', ['get', 'code'], code] })
  return feature ? { ...feature.properties } : null
}

// With no view in the URL, show all of metropolitan France (Corsica included) whatever the screen shape,
// keeping clear of the side panels on wide screens and of the legend strip on phones.
function nationalView() {
  const wide = matchMedia(WIDE_SCREEN).matches
  return {
    bounds: METROPOLITAN_FRANCE,
    fitBoundsOptions: wide
      ? { padding: { top: 16, bottom: 16, left: 320, right: 340 } }
      : { padding: { top: 8, bottom: 96, left: 8, right: 8 } },
  }
}

export interface MapViewProps {
  manifest: Manifest
}

export function MapView({ manifest }: MapViewProps) {
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
      style: buildStyle(tileUrl(manifest), initial.priceType, initial.lang),
      ...(initialState.viewProvided ? { center: [initialState.lng, initialState.lat], zoom: initialState.zoom } : nationalView()),
      minZoom: 3.5,
      maxZoom: 15,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
      // Three device pixels per CSS pixel triples the fill cost on phones for no visible gain on flat colour fills.
      pixelRatio: Math.min(window.devicePixelRatio || 1, matchMedia(WIDE_SCREEN).matches ? 3 : 2),
      hash: false,
    })
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
          filters: state.filters,
        }),
      )
    }

    const showSelection = (selection: ReturnType<typeof store.getState>['selection']) => {
      const code = selection ? String(selection.props.code ?? '') : ''
      for (const [kind, layers] of Object.entries(SELECTION_LAYERS)) {
        for (const id of layers) map.setFilter(id, ['==', ['get', 'code'], selection?.kind === kind ? code : ''])
      }
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

    map.on('load', () => {
      applyAppearance(map, store.getState())
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
          map.getCanvas().style.cursor = pickFeature(map, event.point) ? 'pointer' : ''
        })
      })
    }

    const unsubscribe = store.subscribe((state, previous) => {
      const appearanceChanged = state.priceType !== previous.priceType || state.theme !== previous.theme || state.filters !== previous.filters
      if (appearanceChanged && map.isStyleLoaded()) applyAppearance(map, state)
      if (state.selection !== previous.selection) showSelection(state.selection)
      if (appearanceChanged || state.selection !== previous.selection) syncHash()
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
  }, [manifest])

  return <div ref={container} className="map" role="region" aria-label={t('status.mapLabel')} />
}
