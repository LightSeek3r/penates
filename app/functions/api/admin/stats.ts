import { type AccessEnv, verifyAccess } from '../../_lib/access'
import { readCounters } from '../../_lib/db'
import { type EdgeEnv, fetchEdge } from '../../_lib/edge'
import { buildStats } from '../../_lib/stats'

interface Env extends AccessEnv, EdgeEnv {
  DB?: D1Database
}

const RANGES = [7, 30, 90]
const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'content-type': 'application/json' }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const access = await verifyAccess(request, env)
  if (!access.ok) {
    console.warn('admin stats denied:', access.reason)
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers })
  }

  const requested = Number(new URL(request.url).searchParams.get('days'))
  const days = RANGES.includes(requested) ? requested : 30
  const [rows, edge] = await Promise.all([env.DB ? readCounters(env.DB, days) : Promise.resolve([]), fetchEdge(env, days)])

  return new Response(JSON.stringify({ configured: Boolean(env.DB), generatedAt: new Date().toISOString(), days, stats: buildStats(rows, days), edge, user: access.email }), { headers })
}
