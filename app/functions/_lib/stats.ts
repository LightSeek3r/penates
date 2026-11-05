import { type CounterRow } from './db'
import { dayOf } from './events'

export interface Share {
  key: string
  n: number
}

export interface VitalSplit {
  good: number
  ni: number
  poor: number
}

export interface Stats {
  days: string[]
  series: { pageviews: number[]; selections: number[]; searches: number[] }
  totals: { pageviews: number; selections: number; searches: number; installs: number; offlineSaves: number; mapErrors: number }
  breakdown: Record<'lang' | 'device' | 'source' | 'country' | 'theme' | 'filter', Share[]>
  /** Share of page loads rated good / needs improvement / poor, per metric and device. */
  vitals: Record<string, Record<'phone' | 'desktop', VitalSplit>>
}

const BREAKDOWNS = ['lang', 'device', 'source', 'country', 'theme', 'filter'] as const
const VITALS = ['vitals_lcp', 'vitals_inp', 'vitals_cls', 'vitals_fcp'] as const
const TOP = 12

export function lastDays(days: number, now: Date): string[] {
  return Array.from({ length: days }, (_, index) => dayOf(new Date(now.getTime() - (days - 1 - index) * 86_400_000)))
}

export function buildStats(allRows: CounterRow[], days: number, now = new Date()): Stats {
  const axis = lastDays(days, now)
  const position = new Map(axis.map((day, index) => [day, index]))
  const rows = allRows.filter((row) => position.has(row.day))
  const series = (name: string) => {
    const values = axis.map(() => 0)
    for (const row of rows) if (row.name === name && row.key === 'total') values[position.get(row.day) as number] += row.n
    return values
  }
  const total = (name: string, key = 'total') => rows.filter((row) => row.name === name && row.key === key).reduce((sum, row) => sum + row.n, 0)

  const breakdown = Object.fromEntries(
    BREAKDOWNS.map((name) => {
      const sums = new Map<string, number>()
      for (const row of rows) if (row.name === name) sums.set(row.key, (sums.get(row.key) ?? 0) + row.n)
      return [name, [...sums].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, TOP)]
    }),
  ) as Stats['breakdown']

  const vitals: Stats['vitals'] = {}
  for (const metric of VITALS) {
    const split = { phone: { good: 0, ni: 0, poor: 0 }, desktop: { good: 0, ni: 0, poor: 0 } }
    for (const row of rows) {
      if (row.name !== metric) continue
      const [rating, device] = row.key.split('.') as [keyof VitalSplit, 'phone' | 'desktop']
      split[device][rating] += row.n
    }
    vitals[metric] = split
  }

  return {
    days: axis,
    series: { pageviews: series('pageview'), selections: series('select'), searches: series('search') },
    totals: {
      pageviews: total('pageview'),
      selections: total('select'),
      searches: total('search'),
      installs: total('install', 'accepted'),
      offlineSaves: total('offline_map', 'saved'),
      mapErrors: total('map_error'),
    },
    breakdown,
    vitals,
  }
}
