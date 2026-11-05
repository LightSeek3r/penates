import { create } from 'zustand'

export type OfflineMapStatus = 'unknown' | 'none' | 'downloading' | 'ready' | 'error'

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  online: boolean
  installEvent: InstallPromptEvent | null
  installed: boolean
  updateReady: boolean
  offlineMap: OfflineMapStatus
  loaded: number
  total: number
  applyUpdate: (() => Promise<void>) | null
  set: (patch: Partial<Omit<PwaState, 'set'>>) => void
}

export const usePwaStore = create<PwaState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  installEvent: null,
  installed: false,
  updateReady: false,
  offlineMap: 'unknown',
  loaded: 0,
  total: 0,
  applyUpdate: null,
  set: (patch) => set(patch),
}))
