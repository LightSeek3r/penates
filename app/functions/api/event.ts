import { record } from '../_lib/db'
import { MAX_BODY_BYTES, countryEvent, normaliseEvents } from '../_lib/events'

interface Env {
  DB?: D1Database
}

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } })

/** Receives a batch of anonymous counter events from the page. Stores totals per day only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return empty(403)

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return empty(413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return empty(400)
  }

  const events = normaliseEvents(body)
  if (events.length === 0 || !env.DB) return empty(204)
  const country = events.some((event) => event.name === 'pageview') ? countryEvent(request.cf?.country) : []
  try {
    await record(env.DB, [...events, ...country])
  } catch (error) {
    console.error('counter write failed', (error as Error).message)
  }
  return empty(204)
}
