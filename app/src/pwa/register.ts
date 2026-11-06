import { registerSW } from 'virtual:pwa-register'
import { track } from '../analytics/track'
import { TILES_CACHE } from './constants'
import { type InstallPromptEvent, usePwaStore } from './pwaStore'

const set = usePwaStore.getState().set

export async function refreshOfflineStatus(tileUrl: string | null): Promise<void> {
  if (!tileUrl || !('caches' in window)) return set({ offlineMap: 'none' })
  const cache = await caches.open(TILES_CACHE)
  set({ offlineMap: (await cache.match(tileUrl)) ? 'ready' : 'none' })
}

export async function saveMapOffline(tileUrl: string): Promise<void> {
  const registration = await navigator.serviceWorker?.ready
  if (!registration?.active) return set({ offlineMap: 'error' })
  set({ offlineMap: 'downloading', loaded: 0, total: 0 })
  void navigator.storage?.persist?.()
  registration.active.postMessage({ type: 'SAVE_TILES', url: tileUrl })
}

export async function removeMapOffline(): Promise<void> {
  await caches.delete(TILES_CACHE)
  set({ offlineMap: 'none', loaded: 0, total: 0 })
  track('offline_map', 'removed')
}

export async function promptInstall(): Promise<void> {
  const { installEvent } = usePwaStore.getState()
  if (!installEvent) return
  await installEvent.prompt()
  const { outcome } = await installEvent.userChoice
  set({ installEvent: null, installed: outcome === 'accepted' })
  if (outcome === 'accepted') track('install', 'accepted')
}

/**
 * Wires install, update, connectivity and offline-download events into the store, and registers the service
 * worker once `registerAfter` settles: its precache (the whole app, about 2.6 MB) then no longer competes with
 * the map's first tiles on a first visit.
 */
export function startPwa(registerAfter: Promise<unknown>): void {
  window.addEventListener('online', () => set({ online: true }))
  window.addEventListener('offline', () => set({ online: false }))
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    set({ installEvent: event as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => set({ installed: true, installEvent: null }))
  set({ installed: window.matchMedia('(display-mode: standalone)').matches })

  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string; loaded?: number; total?: number }>) => {
    const { type, loaded = 0, total = 0 } = event.data ?? {}
    if (type === 'TILES_PROGRESS') set({ offlineMap: 'downloading', loaded, total })
    if (type === 'TILES_DONE') {
      set({ offlineMap: 'ready' })
      track('offline_map', 'saved')
    }
    if (type === 'TILES_ERROR') set({ offlineMap: 'error' })
  })

  void registerAfter.finally(() => {
    const update = registerSW({
      onNeedRefresh() {
        set({ updateReady: true, applyUpdate: () => update(true) })
      },
    })
  })
}
