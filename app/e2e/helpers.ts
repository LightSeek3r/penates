import { expect, type Page } from '@playwright/test'

// On phones the colour/filter panel and the legend details sit in the bottom sheet behind "Couches".
export async function openLayersOnPhone(page: Page) {
  const toggle = page.getByRole('button', { name: /^(Couches|Layers)$/ })
  if (await toggle.isVisible()) await toggle.click()
}

// The shareable URL is written by the map, so interactions wait until it is ready.
export async function mapReady(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-map-status', 'ready', { timeout: 40_000 })
}

// Indicator groups in the colour and filter lists are collapsible; opening one closes the others.
export async function openGroup(page: Page, title: string) {
  const summary = page.locator('summary', { hasText: title })
  if ((await summary.locator('xpath=..').getAttribute('open')) === null) await summary.click()
}

/**
 * Properties the local or deployed communes tiles carry, read from the PMTiles metadata, so tests of indicators
 * the data pipeline has not delivered yet can skip instead of failing. Null when the data host is unknown.
 */
export async function communeTileFields(): Promise<Set<string> | null> {
  const remote = process.env.E2E_BASE_URL
  const base = process.env.E2E_DATA_BASE ?? (remote ? null : `http://localhost:${process.env.DATA_PORT ?? 8788}`)
  if (!base) return null
  const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as { tiles: { file: string } }
  const { PMTiles } = await import('pmtiles')
  const metadata = (await new PMTiles(`${base}/${manifest.tiles.file}`).getMetadata()) as { vector_layers?: { id: string; fields: Record<string, string> }[] }
  const communes = metadata.vector_layers?.find((layer) => layer.id === 'communes')
  return new Set(Object.keys(communes?.fields ?? {}))
}

/**
 * The overlays manifest the local or deployed data host serves, or null when it has none (the app then offers no
 * overlay) or the data host is unknown, so overlay tests can skip until the pipeline has delivered the archive.
 */
export type OverlayManifest = { layers?: Record<string, unknown> }

export async function overlayManifest(): Promise<OverlayManifest | null> {
  const remote = process.env.E2E_BASE_URL
  const base = process.env.E2E_DATA_BASE ?? (remote ? null : `http://localhost:${process.env.DATA_PORT ?? 8788}`)
  if (!base) return null
  const response = await fetch(`${base}/overlays.json`)
  return response.ok ? ((await response.json()) as OverlayManifest) : null
}

/**
 * Whether the manifest's `risk` layer holds a line of this risk at any level (`lines: { flood: { "1": 90 } }`), the rule
 * the app uses to offer the overlay; false for a manifest with no `risk` layer.
 */
export function hasRiskLines(manifest: OverlayManifest | null, id: string): boolean {
  const risk = manifest?.layers?.risk as { lines?: Record<string, Record<string, number>> } | undefined
  return Object.values(risk?.lines?.[id] ?? {}).some((count) => count > 0)
}
