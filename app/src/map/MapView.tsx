import { Map as MapLibreMap, NavigationControl, ScaleControl, addProtocol, setWorkerUrl, type MapGeoJSONFeature, type PointLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { tileUrl } from '../data/manifest'
import type { Manifest } from '../state/store'
import { initialState, useAppStore } from '../state/appStore'
import { formatHash } from '../state/urlState'
import { registerPatterns } from './patterns'
import { LAYER_IDS, buildStyle, confidenceFilter } from './style'
import { priceFillExpression } from '../domain/priceLadder'

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
const PATTERN_LAYERS: ReadonlyArray<readonly [string, number]> = [
  ['communes-low', 1],
  ['communes-none', 0],
  ['communes-nocoverage', 4],
  ['departments-nocoverage', 4],
]

function applyPriceType(map: MapLibreMap, type: Parameters<typeof priceFillExpression>[0]) {
  for (const id of [LAYER_IDS.departmentsFill, LAYER_IDS.communesFill]) {
    map.setPaintProperty(id, 'fill-color', priceFillExpression(type))
  }
  for (const [id, value] of PATTERN_LAYERS) map.setFilter(id, confidenceFilter(type, value))
}

type Picked = { kind: 'commune' | 'department'; feature: MapGeoJSONFeature }

function pickFeature(map: MapLibreMap, point: PointLike): Picked | null {
  const features = map.queryRenderedFeatures(point, { layers: [LAYER_IDS.communesFill, LAYER_IDS.departmentsFill] })
  const inLayer = (id: string) => features.find((feature) => feature.layer.id === id)
  const commune: Picked | undefined = (f => f && { kind: 'commune' as const, feature: f })(inLayer(LAYER_IDS.communesFill))
  const department: Picked | undefined = (f => f && { kind: 'department' as const, feature: f })(inLayer(LAYER_IDS.departmentsFill))
  const ordered = map.getZoom() >= COMMUNE_ZOOM ? [commune, department] : [department, commune]
  return ordered.find((candidate) => candidate !== undefined) ?? null
}

function resolveCommune(map: MapLibreMap, code: string): Record<string, unknown> | null {
  const [feature] = map.querySourceFeatures('data', { sourceLayer: 'communes', filter: ['==', ['get', 'code'], code] })
  return feature ? { ...feature.properties } : null
}

export function MapView({ manifest }: { manifest: Manifest }) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    registerProtocol()
    const store = useAppStore

    const map = new MapLibreMap({
      container: element,
      style: buildStyle(tileUrl(manifest), store.getState().priceType),
      center: [initialState.lng, initialState.lat],
      zoom: initialState.zoom,
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
      if (!map.getLayer(LAYER_IDS.communesSelected)) return
      const code = selection ? String(selection.props.code ?? '') : ''
      map.setFilter(LAYER_IDS.communesSelected, ['==', ['get', 'code'], selection?.kind === 'commune' ? code : ''])
      map.setFilter(LAYER_IDS.departmentsSelected, ['==', ['get', 'code'], selection?.kind === 'department' ? code : ''])
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
      store.getState().setMapStatus('ready')
      map.once('idle', () => resolvePending(false))
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
