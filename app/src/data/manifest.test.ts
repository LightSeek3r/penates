import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

describe('parseManifest', () => {
  it('reads the pipeline manifest', () => {
    const parsed = parseManifest({
      version: '2026-11-04',
      tiles: { file: 'communes.pmtiles', bytes: 1 },
      sources: { transactions: { from: '2021-01-04', to: '2025-12-31' } },
    })
    expect(parsed).toEqual({ version: '2026-11-04', tiles: { file: 'communes.pmtiles' }, dataThrough: '2025-12-31' })
  })

  it('rejects a manifest without a tile file', () => {
    expect(() => parseManifest({ version: 'x' })).toThrow('Invalid manifest')
    expect(() => parseManifest(null)).toThrow('Invalid manifest')
  })
})
