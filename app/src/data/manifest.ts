import { type OverlaySources, PLACE_KINDS, RISK_LINES } from '../domain/overlays'
import type { Manifest } from '../state/store'

export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? 'http://localhost:8788'

export function parseManifest(value: unknown): Manifest {
  const manifest = value as {
    version?: unknown
    tiles?: { file?: unknown; bytes?: unknown }
    sources?: { transactions?: { to?: unknown } }
  } | null
  if (typeof manifest?.version !== 'string' || typeof manifest.tiles?.file !== 'string') {
    throw new Error('Invalid manifest')
  }
  const through = manifest.sources?.transactions?.to
  return {
    version: manifest.version,
    tiles: { file: manifest.tiles.file, bytes: typeof manifest.tiles.bytes === 'number' ? manifest.tiles.bytes : undefined },
    dataThrough: typeof through === 'string' ? through : undefined,
  }
}

export async function loadManifest(): Promise<Manifest> {
  const response = await fetch(`${DATA_BASE}/manifest.json`, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`)
  return parseManifest(await response.json())
}

export function tileUrl(manifest: Manifest): string {
  return new URL(manifest.tiles.file, `${DATA_BASE}/`).toString()
}

export interface OverlaysManifest {
  version: string
  /** Archive path, relative to the data base. */
  file: string
  sources: OverlaySources
}

const PLACE_IDS: ReadonlySet<string> = new Set(PLACE_KINDS.map((kind) => kind.id))
const RISK_IDS: ReadonlySet<string> = new Set(Object.keys(RISK_LINES))

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// The pipeline's summary of a line layer counts its lines by level (`{ "2": 120, "3": 80 }`).
const hasLines = (counts: unknown): boolean => isRecord(counts) && Object.values(counts).some((count) => typeof count === 'number' && count > 0)

// The `risk` layer nests those counts under the risk id (`lines: { flood: { "1": 90 }, clay: { ... } }`).
function risksWithLines(layer: unknown): string[] {
  const lines = isRecord(layer) && isRecord(layer.lines) ? layer.lines : {}
  return Object.entries(lines).flatMap(([id, counts]) => (RISK_IDS.has(id) && hasLines(counts) ? [id] : []))
}

/** Reads `overlays.json`; null when it is not the archive's manifest, so overlays are then simply not offered. */
export function parseOverlaysManifest(value: unknown): OverlaysManifest | null {
  if (!isRecord(value) || typeof value.version !== 'string' || !isRecord(value.tiles) || typeof value.tiles.file !== 'string') return null
  const layers = isRecord(value.layers) ? value.layers : {}
  const kinds = isRecord(layers.places) && isRecord(layers.places.kinds) ? layers.places.kinds : {}
  const places = Object.entries(kinds).flatMap(([id, count]) => (PLACE_IDS.has(id) && typeof count === 'number' && count > 0 ? [id] : []))
  const seismic = isRecord(layers.seismic) && hasLines(layers.seismic.lines)
  return { version: value.version, file: value.tiles.file, sources: { places: new Set(places), seismic, risks: new Set(risksWithLines(layers.risk)) } }
}

// A manifest that does not answer must not hold the map back: the overlays are then left out for this visit.
const OVERLAYS_MANIFEST_TIMEOUT_MS = 5000

/** The overlays manifest, or null when there is none, it cannot be read or it takes too long; never throws. */
export async function loadOverlaysManifest(): Promise<OverlaysManifest | null> {
  try {
    const response = await fetch(`${DATA_BASE}/overlays.json`, { cache: 'no-cache', signal: AbortSignal.timeout(OVERLAYS_MANIFEST_TIMEOUT_MS) })
    return response.ok ? parseOverlaysManifest(await response.json()) : null
  } catch {
    return null
  }
}

export const overlaysTileUrl = (manifest: OverlaysManifest): string => new URL(manifest.file, `${DATA_BASE}/`).toString()
