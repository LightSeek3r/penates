import { beforeEach, describe, expect, it } from 'vitest'
import { resetAccessKeyCache, verifyAccess } from './access'
import { summariseEdge, fetchEdge } from './edge'
import { MAX_EVENTS_PER_REQUEST, countryEvent, dayOf, isValidEvent, normaliseEvents } from './events'
import { buildStats, lastDays } from './stats'

describe('events', () => {
  it('accepts only names and values from the closed lists', () => {
    expect(isValidEvent({ name: 'pageview', key: 'total' })).toBe(true)
    expect(isValidEvent({ name: 'theme', key: 'hospital' })).toBe(true)
    expect(isValidEvent({ name: 'source', key: 'www.google.com' })).toBe(true)
    expect(isValidEvent({ name: 'vitals_lcp', key: 'good.phone' })).toBe(true)
    expect(isValidEvent({ name: 'theme', key: 'free text' })).toBe(false)
    expect(isValidEvent({ name: 'search', key: 'Lyon' })).toBe(false)
    expect(isValidEvent({ name: 'source', key: 'not a host!' })).toBe(false)
    expect(isValidEvent({ name: 'vitals_lcp', key: 'great.tablet' })).toBe(false)
    expect(isValidEvent({ name: 'unknown', key: 'total' })).toBe(false)
    expect(isValidEvent(null)).toBe(false)
  })

  it('keeps at most a dozen valid events and ignores malformed bodies', () => {
    const many = { events: Array.from({ length: 40 }, () => ({ name: 'select', key: 'total' })) }
    expect(normaliseEvents(many)).toHaveLength(MAX_EVENTS_PER_REQUEST)
    expect(normaliseEvents({ events: [{ name: 'select', key: 'total', extra: 'ip' }, { name: 'bad', key: 'x' }] })).toEqual([{ name: 'select', key: 'total' }])
    expect(normaliseEvents(null)).toEqual([])
    expect(normaliseEvents({ events: 'nope' })).toEqual([])
  })

  it('turns an edge country into a coarse counter and ignores anything else', () => {
    expect(countryEvent('FR')).toEqual([{ name: 'country', key: 'FR' }])
    expect(countryEvent('fr')).toEqual([])
    expect(countryEvent('T1')).toEqual([])
    expect(countryEvent(undefined)).toEqual([])
  })

  it('uses UTC days', () => {
    expect(dayOf(new Date('2026-11-05T23:59:59Z'))).toBe('2026-11-05')
  })
})

describe('stats', () => {
  const now = new Date('2026-11-05T12:00:00Z')

  it('lists the last days in order', () => {
    expect(lastDays(3, now)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
  })

  it('sums counters into series, totals and ranked breakdowns', () => {
    const rows = [
      { day: '2026-11-04', name: 'pageview', key: 'total', n: 10 },
      { day: '2026-11-05', name: 'pageview', key: 'total', n: 5 },
      { day: '2026-11-05', name: 'theme', key: 'hospital', n: 3 },
      { day: '2026-11-04', name: 'theme', key: 'seismic', n: 7 },
      { day: '2026-11-05', name: 'install', key: 'accepted', n: 2 },
      { day: '2026-11-05', name: 'vitals_lcp', key: 'good.phone', n: 8 },
      { day: '2026-11-05', name: 'vitals_lcp', key: 'poor.phone', n: 2 },
      { day: '2026-10-01', name: 'pageview', key: 'total', n: 999 },
    ]
    const stats = buildStats(rows, 3, now)
    expect(stats.series.pageviews).toEqual([0, 10, 5])
    expect(stats.totals.pageviews).toBe(15)
    expect(stats.breakdown.theme).toEqual([{ key: 'seismic', n: 7 }, { key: 'hospital', n: 3 }])
    expect(stats.totals.installs).toBe(2)
    expect(stats.vitals.vitals_lcp.phone).toEqual({ good: 8, ni: 0, poor: 2 })
  })
})

describe('edge statistics', () => {
  it('is unavailable without a token', async () => {
    expect(await fetchEdge({}, 30)).toEqual({ available: false, reason: 'No Cloudflare analytics token is configured.' })
  })

  it('reports an API failure instead of throwing', async () => {
    const failing = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch
    const result = await fetchEdge({ CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' }, 7, failing)
    expect(result).toEqual({ available: false, reason: 'Cloudflare answered 403.' })
  })

  it('groups status codes and cache results', () => {
    const edge = summariseEdge({
      daily: [{ count: 10, dimensions: { date: '2026-11-05' }, sum: { edgeResponseBytes: 2048 } }],
      status: [{ count: 8, dimensions: { edgeResponseStatusCode: 200 } }, { count: 1, dimensions: { edgeResponseStatusCode: 304 } }, { count: 1, dimensions: { edgeResponseStatusCode: 404 } }],
      cache: [{ count: 6, dimensions: { cacheStatus: 'hit' } }, { count: 4, dimensions: { cacheStatus: 'miss' } }],
    })
    expect(edge.status).toEqual({ '2xx': 8, '3xx': 1, '4xx': 1, '5xx': 0 })
    expect(edge.cache).toEqual({ hit: 6, other: 4 })
    expect(edge.days).toEqual([{ date: '2026-11-05', requests: 10, bytes: 2048 }])
  })
})

describe('Cloudflare Access verification', () => {
  const team = 'team.cloudflareaccess.com'
  const audience = 'aud-123'
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const bytesToB64Url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  let keys: CryptoKeyPair
  let jwks: { keys: unknown[] }

  const fetcher = (async () => new Response(JSON.stringify(jwks))) as unknown as typeof fetch

  async function token(claims: Record<string, unknown>, signWith = keys.privateKey) {
    const head = encode({ alg: 'RS256', kid: 'k1' })
    const body = encode(claims)
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signWith, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${bytesToB64Url(signature)}`
  }

  const requestWith = (jwt: string | null) => new Request('https://penates.unit42.fr/api/admin/stats', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} })
  const good = { aud: [audience], iss: `https://${team}`, exp: Math.floor(Date.now() / 1000) + 600, email: 'owner@example.com' }
  const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: audience }

  beforeEach(async () => {
    resetAccessKeyCache()
    keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
    jwks = { keys: [{ ...jwk, kid: 'k1', alg: 'RS256' }] }
  })

  it('accepts a correctly signed token for this application', async () => {
    expect(await verifyAccess(requestWith(await token(good)), env, fetcher)).toEqual({ ok: true, email: 'owner@example.com' })
  })

  it('fails closed when Access is not configured or no token is sent', async () => {
    expect(await verifyAccess(requestWith(await token(good)), {}, fetcher)).toMatchObject({ ok: false })
    expect(await verifyAccess(requestWith(null), env, fetcher)).toMatchObject({ ok: false })
  })

  it('rejects a wrong audience, issuer, expiry or signature', async () => {
    expect(await verifyAccess(requestWith(await token({ ...good, aud: ['other'] })), env, fetcher)).toMatchObject({ ok: false, reason: 'Wrong audience' })
    expect(await verifyAccess(requestWith(await token({ ...good, iss: 'https://evil.example' })), env, fetcher)).toMatchObject({ ok: false, reason: 'Wrong issuer' })
    expect(await verifyAccess(requestWith(await token({ ...good, exp: 1 })), env, fetcher)).toMatchObject({ ok: false, reason: 'Expired' })
    const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    expect(await verifyAccess(requestWith(await token(good, other.privateKey)), env, fetcher)).toMatchObject({ ok: false, reason: 'Bad signature' })
  })

  it('honours the development bypass only when it is explicitly set to 1', async () => {
    expect(await verifyAccess(requestWith(null), { ADMIN_DEV_BYPASS: '1' }, fetcher)).toEqual({ ok: true, email: null })
    expect(await verifyAccess(requestWith(null), { ADMIN_DEV_BYPASS: 'true' }, fetcher)).toMatchObject({ ok: false })
  })
})
