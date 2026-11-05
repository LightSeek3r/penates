/**
 * Anonymous usage counters. Each event is a name plus a value from a closed list (see functions/_lib/events.ts);
 * there is no identifier, no cookie and no free text. The server only adds one to the day's total.
 */

export interface CounterEvent {
  name: string
  key: string
}

export type Device = 'phone' | 'desktop'

export interface TrackingEnvironment {
  production: boolean
  hostname: string
  automated: boolean
  doNotTrack: boolean
  globalPrivacyControl: boolean
  optedOut: boolean
}

export const OPT_OUT_KEY = 'settling.optout'
const FLUSH_DELAY_MS = 3000
const PHONE_MAX_WIDTH = 719
const HOST = /^[a-z0-9][a-z0-9.-]{1,58}[a-z0-9]$/

/** Counting is off in development, on localhost, in automated browsers and whenever the visitor said no. */
export function trackingAllowed(env: TrackingEnvironment): boolean {
  if (!env.production || env.automated || env.doNotTrack || env.globalPrivacyControl || env.optedOut) return false
  return env.hostname !== 'localhost' && env.hostname !== '127.0.0.1'
}

export const deviceClass = (width: number): Device => (width <= PHONE_MAX_WIDTH ? 'phone' : 'desktop')

/** Where the visit came from, reduced to a host name: never a full address. */
export function sourceOf(referrer: string, ownHost: string, standalone: boolean): string {
  if (standalone) return 'pwa'
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    return host === ownHost || !HOST.test(host) ? 'direct' : host
  } catch {
    return 'direct'
  }
}

const RATINGS: Record<string, string> = { good: 'good', 'needs-improvement': 'ni', poor: 'poor' }
export const vitalKey = (rating: string, device: Device) => `${RATINGS[rating] ?? 'poor'}.${device}`

function readEnvironment(): TrackingEnvironment {
  let optedOut = false
  try {
    optedOut = localStorage.getItem(OPT_OUT_KEY) === '1'
  } catch {
    // Storage can be unavailable (private mode); counting then follows the other signals.
  }
  return {
    production: import.meta.env.PROD,
    hostname: location.hostname,
    automated: navigator.webdriver,
    doNotTrack: navigator.doNotTrack === '1',
    globalPrivacyControl: Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl),
    optedOut,
  }
}

export function isOptedOut(): boolean {
  return readEnvironment().optedOut
}

export function setOptOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, '1')
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    // Nothing to remember the choice with; counting still stops for this page below.
  }
  if (value) queue.length = 0
}

const queue: CounterEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush(): void {
  clearTimeout(timer)
  timer = undefined
  if (queue.length === 0) return
  const events = queue.splice(0)
  navigator.sendBeacon?.('/api/event', new Blob([JSON.stringify({ events })], { type: 'application/json' }))
}

export function track(name: string, key = 'total'): void {
  if (!trackingAllowed(readEnvironment())) return
  queue.push({ name, key })
  timer ??= setTimeout(flush, FLUSH_DELAY_MS)
}

export function startFlushing(): void {
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

export function trackPageview(lang: 'fr' | 'en'): void {
  track('pageview')
  track('lang', lang)
  track('device', deviceClass(innerWidth))
  track('source', sourceOf(document.referrer, location.hostname, matchMedia('(display-mode: standalone)').matches))
}

/** Page-speed ratings (good / needs improvement / poor) as counters; the measured values are never sent. */
export async function trackVitals(): Promise<void> {
  const { onCLS, onFCP, onINP, onLCP } = await import('web-vitals')
  const device = deviceClass(innerWidth)
  const report = (name: string) => (metric: { rating: string }) => track(name, vitalKey(metric.rating, device))
  onLCP(report('vitals_lcp'))
  onINP(report('vitals_inp'))
  onCLS(report('vitals_cls'))
  onFCP(report('vitals_fcp'))
}
