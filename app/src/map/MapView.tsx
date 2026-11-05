import { Map as MapLibreMap, NavigationControl, ScaleControl, addProtocol, setWorkerUrl, type MapGeoJSONFeature, type PointLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { tileUrl } from '../data/manifest'
import type { PriceType } from '../domain/place'
import { priceFillExpression } from '../domain/priceLadder'
import { initialState, useAppStore } from '../state/appStore'
import type { Manifest } from '../state/store'
import { formatHash } from '../state/urlState'
import { registerPatterns } from './patterns'
import { LAYER_IDS, SELECTION_LAYERS, buildStyle, patternFilters } from './style'

let protocolRegistered = false
function registerProtocol() {
  if (protocolRegistered) return
  // MapLibre 6 starts a module worker from a URL the bundler does not emit on its own.
  setWorkerUrl(workerUrl)
  addProtocol('pmtiles', new Protocol().tile)
  protocolRegistered = true
}

const COMMUNE_ZOOM = 6.5
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const WIDE_SCREEN = '(min-width: 720px)'
const METROPOLITAN_FRANCE: [[number, number], [number, number]] = [[-5.6, 41.0], [10.0, 51.3]]

function applyPriceType(map: MapLibreMap, type: PriceType) {
  for (const id of [LAYER_IDS.departmentsFill, LAYER_IDS.communesFill]) {
    map.setPaintProperty(id, 'fill-color', priceFillExpression(type))
  }
  for (const [id, filter] of Object.entries(patternFilters(type))) map.setFilter(id, filter)
}

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

export function MapView({ manifest }: { manifest: Manifest }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    registerProtocol()
    const store = useAppStore
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
      hash: false,
    })
    map.touchZoomRotate.disableRotation()
    map.touchPitch.disable()
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
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
          lang: state.lang,
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
      // The compact attribution opens by default and covers the map on phones; users can still open it.
      const attribution = element.querySelector('.maplibregl-ctrl-attrib')
      attribution?.classList.remove('maplibregl-compact-show')
      attribution?.removeAttribute('open')
      store.getState().setMapStatus('ready')
      map.once('idle', () => resolvePending(false))
      syncHash()
    })
    map.on('error', (event) => {
      if (store.getState().mapStatus === 'loading' && (event as { sourceId?: string }).sourceId === 'data') {
        store.getState().setMapStatus('error')
      }
    })
    map.on('moveend', syncHash)
    map.on('click', (event) => {
      const picked = pickFeature(map, event.point)
      store.getState().select(picked ? { kind: picked.kind, props: { ...picked.feature.properties } } : null)
    })
    map.on('mousemove', (event) => {
      map.getCanvas().style.cursor = pickFeature(map, event.point) ? 'pointer' : ''
    })

    const unsubscribe = store.subscribe((state, previous) => {
      if (state.priceType !== previous.priceType && map.isStyleLoaded()) applyPriceType(map, state.priceType)
      if (state.selection !== previous.selection) showSelection(state.selection)
      if (state.lang !== previous.lang && map.getLayer('notes-label')) {
        map.setLayoutProperty('notes-label', 'text-field', ['get', state.lang])
      }
      if (state.priceType !== previous.priceType || state.selection !== previous.selection || state.lang !== previous.lang) syncHash()
      const request = state.flyRequest
      if (request && request !== previous.flyRequest) {
        map.flyTo({ center: [request.lng, request.lat], zoom: request.zoom, essential: true, animate: !matchMedia(REDUCED_MOTION).matches })
        map.once('idle', () => resolvePending(true))
      }
    })

    return () => {
      unsubscribe()
      map.remove()
    }
  }, [manifest])

  return <div ref={container} className="map" role="region" aria-label={t('status.mapLabel')} />
}
