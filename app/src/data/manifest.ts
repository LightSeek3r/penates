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

export async function loadManifest(signal: AbortSignal): Promise<Manifest> {
  const response = await fetch(`${DATA_BASE}/manifest.json`, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`)
  return parseManifest(await response.json())
}

export function tileUrl(manifest: Manifest): string {
  return new URL(manifest.tiles.file, `${DATA_BASE}/`).toString()
}
