/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { createPartialResponse } from 'workbox-range-requests'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { TILES_CACHE } from './pwa/constants'

declare const self: ServiceWorkerGlobalScope

const PROGRESS_INTERVAL_MS = 250

// The app shell and the documentation pages are precached, so the application opens offline.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

// Basemap tiles, glyphs and TileJSON already seen: shown immediately, refreshed in the background.
registerRoute(
  ({ url }) => url.origin === 'https://tiles.openfreemap.org',
  new StaleWhileRevalidate({
    cacheName: 'basemap',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
)

// The data manifest names the current tile file, so it must stay fresh online and available offline.
registerRoute(
  ({ url }) => url.pathname.endsWith('/manifest.json'),
  new NetworkFirst({ cacheName: 'data-manifest', networkTimeoutSeconds: 4, plugins: [new CacheableResponsePlugin({ statuses: [200] })] }),
)

// PMTiles are read with HTTP Range requests. When the user saved the file for offline use it is
// served from the cache (sliced to the requested range); otherwise the request goes to the network.
registerRoute(
  ({ url }) => url.pathname.endsWith('.pmtiles'),
  async ({ request }) => {
    const cache = await caches.open(TILES_CACHE)
    const stored = await cache.match(request.url)
    return stored ? createPartialResponse(request, stored) : fetch(request)
  },
)

async function broadcast(message: unknown): Promise<void> {
  for (const client of await self.clients.matchAll()) client.postMessage(message)
}

async function saveTiles(url: string): Promise<void> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    let loaded = 0
    let lastReport = 0
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength
          const now = Date.now()
          if (now - lastReport > PROGRESS_INTERVAL_MS) {
            lastReport = now
            void broadcast({ type: 'TILES_PROGRESS', loaded, total })
          }
          controller.enqueue(chunk)
        },
      }),
    )
    const cache = await caches.open(TILES_CACHE)
    // Only one tile file is kept: older versions are dropped once the new one is safely stored.
    await cache.put(url, new Response(counted, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(total || loaded) } }))
    for (const key of await cache.keys()) if (key.url !== url) await cache.delete(key)
    await broadcast({ type: 'TILES_DONE', url })
  } catch (error) {
    await broadcast({ type: 'TILES_ERROR', message: (error as Error).message })
  }
}

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; url?: string } | undefined
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting()
  if (data?.type === 'SAVE_TILES' && data.url) event.waitUntil(saveTiles(data.url))
})

clientsClaim()
