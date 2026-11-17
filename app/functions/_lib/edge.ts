/**
 * Cloudflare's own request statistics for the site (all requests, bots included), read from the GraphQL
 * Analytics API with a read-only token. Optional: when the token is absent the admin page says so.
 */

export interface EdgeEnv {
  CF_ANALYTICS_TOKEN?: string
  CF_ZONE_ID?: string
  SITE_HOST?: string
}

export interface EdgeStats {
  days: { date: string; requests: number; bytes: number }[]
  status: Record<'2xx' | '3xx' | '4xx' | '5xx', number>
  cache: { hit: number; other: number }
}

export type EdgeResult = { available: true; stats: EdgeStats } | { available: false; reason: string }

const QUERY = `query ($zone: String!, $from: Time!, $to: Time!, $host: String!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    daily: httpRequestsAdaptiveGroups(limit: 200, filter: { datetime_geq: $from, datetime_leq: $to, clientRequestHTTPHost: $host }, orderBy: [date_ASC]) {
      count dimensions { date } sum { edgeResponseBytes }
    }
    status: httpRequestsAdaptiveGroups(limit: 60, filter: { datetime_geq: $from, datetime_leq: $to, clientRequestHTTPHost: $host }, orderBy: [count_DESC]) {
      count dimensions { edgeResponseStatusCode }
    }
    cache: httpRequestsAdaptiveGroups(limit: 20, filter: { datetime_geq: $from, datetime_leq: $to, clientRequestHTTPHost: $host }, orderBy: [count_DESC]) {
      count dimensions { cacheStatus }
    }
  } }
}`

interface Group<D> {
  count: number
  dimensions: D
  sum?: { edgeResponseBytes: number }
}

export function summariseEdge(zone: {
  daily: Group<{ date: string }>[]
  status: Group<{ edgeResponseStatusCode: number }>[]
  cache: Group<{ cacheStatus: string }>[]
}): EdgeStats {
  const status = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  for (const group of zone.status) {
    const family = `${Math.floor(group.dimensions.edgeResponseStatusCode / 100)}xx` as keyof typeof status
    if (family in status) status[family] += group.count
  }
  const cache = { hit: 0, other: 0 }
  for (const group of zone.cache) cache[group.dimensions.cacheStatus === 'hit' ? 'hit' : 'other'] += group.count
  return {
    days: zone.daily.map((group) => ({ date: group.dimensions.date, requests: group.count, bytes: group.sum?.edgeResponseBytes ?? 0 })),
    status,
    cache,
  }
}

export async function fetchEdge(env: EdgeEnv, days: number, fetcher: typeof fetch = fetch, now = new Date()): Promise<EdgeResult> {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return { available: false, reason: 'No Cloudflare analytics token is configured.' }
  const from = new Date(now.getTime() - days * 86_400_000).toISOString()
  try {
    const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { zone: env.CF_ZONE_ID, from, to: now.toISOString(), host: env.SITE_HOST ?? 'penates.unit42.fr' } }),
    })
    if (!response.ok) return { available: false, reason: `Cloudflare answered ${response.status}.` }
    const body = (await response.json()) as { data?: { viewer?: { zones?: Parameters<typeof summariseEdge>[0][] } }; errors?: { message: string }[] }
    if (body.errors?.length) return { available: false, reason: body.errors[0].message }
    const zone = body.data?.viewer?.zones?.[0]
    return zone ? { available: true, stats: summariseEdge(zone) } : { available: false, reason: 'The zone was not found for this token.' }
  } catch (error) {
    return { available: false, reason: (error as Error).message }
  }
}
