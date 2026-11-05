/** Shape of GET /api/admin/stats (see functions/_lib/stats.ts and edge.ts). */
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
  vitals: Record<string, Record<'phone' | 'desktop', VitalSplit>>
}

export interface EdgeStats {
  days: { date: string; requests: number; bytes: number }[]
  status: Record<'2xx' | '3xx' | '4xx' | '5xx', number>
  cache: { hit: number; other: number }
}

export type EdgeResult = { available: true; stats: EdgeStats } | { available: false; reason: string }

export interface AdminResponse {
  configured: boolean
  generatedAt: string
  days: number
  stats: Stats
  edge: EdgeResult
  user: string | null
}
