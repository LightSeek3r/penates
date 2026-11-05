/**
 * Anonymous usage counters. An event is a name and a short value from a closed list; nothing in it can
 * identify a visitor, and the server stores only "how many times per day", never one row per visit.
 */

export interface CounterEvent {
  name: string
  key: string
}

const THEMES = ['price', 'seismic', 'hospital', 'gp', 'school', 'supermarket', 'bakery', 'pool'] as const
const FILTERS = ['price', 'seismic', 'hospital', 'gp', 'school', 'supermarket', 'bakery', 'pool'] as const
const RATINGS = /^(good|ni|poor)\.(phone|desktop)$/
const HOST = /^[a-z0-9]([a-z0-9.-]{1,58})[a-z0-9]$/

const FIXED: Record<string, readonly string[]> = {
  pageview: ['total'],
  lang: ['fr', 'en'],
  device: ['phone', 'desktop'],
  theme: THEMES,
  filter: FILTERS,
  search: ['total'],
  select: ['total'],
  install: ['accepted'],
  offline_map: ['saved', 'removed'],
  map_error: ['total'],
}

const PATTERNED: Record<string, RegExp> = {
  vitals_lcp: RATINGS,
  vitals_inp: RATINGS,
  vitals_cls: RATINGS,
  vitals_fcp: RATINGS,
  source: new RegExp(`^(direct|pwa|${HOST.source.slice(1, -1)})$`),
}

export const MAX_EVENTS_PER_REQUEST = 12
export const MAX_BODY_BYTES = 2048

export function isValidEvent(event: unknown): event is CounterEvent {
  if (typeof event !== 'object' || event === null) return false
  const { name, key } = event as Record<string, unknown>
  if (typeof name !== 'string' || typeof key !== 'string') return false
  const fixed = FIXED[name]
  if (fixed) return fixed.includes(key)
  return PATTERNED[name]?.test(key) ?? false
}

/** Keeps the valid events of a request body (at most a dozen) and silently drops the rest. */
export function normaliseEvents(body: unknown): CounterEvent[] {
  const list = (body as { events?: unknown } | null)?.events
  if (!Array.isArray(list)) return []
  return list.slice(0, MAX_EVENTS_PER_REQUEST).filter(isValidEvent).map(({ name, key }) => ({ name, key }))
}

/** The edge adds the visitor's country as a coarse counter; it is a two-letter code or nothing. */
export function countryEvent(country: unknown): CounterEvent[] {
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? [{ name: 'country', key: country }] : []
}

/** UTC calendar day, the only time resolution that is kept. */
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}
