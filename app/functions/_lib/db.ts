import { type CounterEvent, dayOf } from './events'

const SCHEMA = `CREATE TABLE IF NOT EXISTS counter (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, key)
) WITHOUT ROWID`

const UPSERT = 'INSERT INTO counter (day, name, key, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, name, key) DO UPDATE SET n = n + 1'

/** A day never keeps more than this many different referrer hosts; the rest are counted as "other". */
export const MAX_SOURCES_PER_DAY = 200

const isMissingTable = (error: unknown) => /no such table/i.test(String((error as Error)?.message))

async function foldSource(db: D1Database, day: string, event: CounterEvent): Promise<CounterEvent> {
  if (event.name !== 'source' || event.key === 'direct' || event.key === 'pwa') return event
  const known = await db.prepare('SELECT 1 AS hit FROM counter WHERE day = ?1 AND name = ?2 AND key = ?3').bind(day, 'source', event.key).first()
  if (known) return event
  const count = await db.prepare('SELECT COUNT(*) AS total FROM counter WHERE day = ?1 AND name = ?2').bind(day, 'source').first<{ total: number }>()
  return (count?.total ?? 0) >= MAX_SOURCES_PER_DAY ? { name: 'source', key: 'other' } : event
}

/** Adds one to the day's counter of each event. Creates the table the first time it is needed. */
export async function record(db: D1Database, events: CounterEvent[], now = new Date()): Promise<void> {
  if (events.length === 0) return
  const day = dayOf(now)
  const run = async () => {
    const folded = await Promise.all(events.map((event) => foldSource(db, day, event)))
    await db.batch(folded.map((event) => db.prepare(UPSERT).bind(day, event.name, event.key)))
  }
  try {
    await run()
  } catch (error) {
    if (!isMissingTable(error)) throw error
    await db.exec(SCHEMA.replace(/\s+/g, ' '))
    await run()
  }
}

export interface CounterRow {
  day: string
  name: string
  key: string
  n: number
}

export async function readCounters(db: D1Database, days: number, now = new Date()): Promise<CounterRow[]> {
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000))
  try {
    const { results } = await db.prepare('SELECT day, name, key, n FROM counter WHERE day >= ?1 ORDER BY day').bind(from).all<CounterRow>()
    return results
  } catch (error) {
    if (isMissingTable(error)) return []
    throw error
  }
}
