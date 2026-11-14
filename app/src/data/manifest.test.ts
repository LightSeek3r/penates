import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_BASE, loadOverlaysManifest, overlaysTileUrl, parseManifest, parseOverlaysManifest } from './manifest'

describe('parseManifest', () => {
  it('reads the pipeline manifest', () => {
    const parsed = parseManifest({
      version: '2026-11-04',
      tiles: { file: 'communes.pmtiles', bytes: 1 },
      sources: { transactions: { from: '2021-01-04', to: '2025-12-31' } },
    })
    expect(parsed).toEqual({ version: '2026-11-04', tiles: { file: 'communes.pmtiles', bytes: 1 }, dataThrough: '2025-12-31' })
  })

  it('rejects a manifest without a tile file', () => {
    expect(() => parseManifest({ version: 'x' })).toThrow('Invalid manifest')
    expect(() => parseManifest(null)).toThrow('Invalid manifest')
  })
})

describe('parseOverlaysManifest', () => {
  const manifest = {
    version: '2026-11-13',
    tiles: { file: 'v2026-11-13/overlays.pmtiles', bytes: 5 },
    sources: { bpe: { year: 2025 } },
    layers: {
      places: { kinds: { hos: 3600, gp: 52000, pha: 0, den: 0 } },
      seismic: { lines: { '2': 700, '3': 400, '4': 90, '5': 10 }, length_km: { '2': 9000 } },
      risk: {
        lines: { flood: { '1': 900, '2': 300, '3': 60 }, clay: { '1': 500, '2': 200, '3': 40 }, radon: { '2': 120, '3': 30 }, cavities: { '1': 800, '5': 90, '25': 10 } },
        length_km: { flood: { '1': 40000 } },
        source: { gaspar: { queried_on: '2026-11-13' } },
      },
    },
  }

  it('reads the archive file, the kinds that have dots, the seismic layer and the risks that have lines', () => {
    const parsed = parseOverlaysManifest(manifest)
    expect(parsed).toMatchObject({ version: '2026-11-13', file: 'v2026-11-13/overlays.pmtiles' })
    expect(parsed?.sources.places).toEqual(new Set(['hos', 'gp']))
    expect(parsed?.sources.seismic).toBe(true)
    expect(parsed?.sources.risks).toEqual(new Set(['flood', 'clay', 'radon', 'cavities']))
  })

  it('counts a kind as present only with at least one dot, and ignores kinds this app does not know', () => {
    const parsed = parseOverlaysManifest({ ...manifest, layers: { places: { kinds: { hos: 1, gp: 0, cin: -2, pha: '9', zzz: 40, seismic: 5 } }, seismic: { lines: { '2': 3 } } } })
    expect(parsed?.sources.places).toEqual(new Set(['hos']))
  })

  it('reads the seismic layer as absent when it is missing or holds no line', () => {
    for (const seismic of [undefined, null, 'yes', [], {}, { lines: {} }, { lines: { '2': 0, '3': 0 } }, { lines: { '2': '9' } }, { length_km: { '2': 12 } }]) {
      expect(parseOverlaysManifest({ ...manifest, layers: { ...manifest.layers, seismic } })?.sources.seismic, JSON.stringify(seismic)).toBe(false)
    }
    expect(parseOverlaysManifest({ ...manifest, layers: { places: manifest.layers.places } })?.sources.seismic).toBe(false)
    expect(parseOverlaysManifest({ ...manifest, layers: { ...manifest.layers, seismic: { lines: { '5': 1 } } } })?.sources.seismic).toBe(true)
  })

  const risksOf = (risk: unknown) => parseOverlaysManifest({ ...manifest, layers: { ...manifest.layers, risk } })?.sources.risks

  it('counts a risk as present when it has a line at any level, and a level without lines does not count', () => {
    expect(risksOf({ lines: { flood: { '1': 3 }, clay: { '1': 0, '2': 0 }, radon: { '3': 1 }, cavities: {} } })).toEqual(new Set(['flood', 'radon']))
    expect(risksOf({ lines: { flood: { '3': 1 } } })).toEqual(new Set(['flood']))
    expect(risksOf({ lines: { cavities: { '25': 2, '1': 0 } } })).toEqual(new Set(['cavities']))
  })

  it('reads the risks as absent when the layer is missing, has no line or has them in another shape', () => {
    for (const risk of [undefined, null, 'yes', [], {}, { lines: {} }, { lines: [] }, { lines: { flood: {} } }, { lines: { flood: { '1': 0 } } }, { lines: { flood: { '1': '9' } } }, { lines: { flood: 12 } }, { lines: { flood: [3] } }, { length_km: { flood: { '1': 12 } } }]) {
      expect(risksOf(risk), JSON.stringify(risk)).toEqual(new Set())
    }
    const { risk: _risk, ...withoutRisk } = manifest.layers
    expect(parseOverlaysManifest({ ...manifest, layers: withoutRisk })?.sources.risks).toEqual(new Set())
  })

  it('ignores risk ids this app does not know, and the seismic id, which has its own layer', () => {
    expect(risksOf({ lines: { flood: { '1': 3 }, landslide: { '1': 9 }, seismic: { '2': 4 }, hos: { '1': 1 } } })).toEqual(new Set(['flood']))
  })

  it('keeps the risks apart from the seismic layer: either can be there without the other', () => {
    const seismicOnly = parseOverlaysManifest({ ...manifest, layers: { seismic: manifest.layers.seismic } })?.sources
    expect(seismicOnly).toEqual({ places: new Set(), seismic: true, risks: new Set() })
    const risksOnly = parseOverlaysManifest({ ...manifest, layers: { risk: manifest.layers.risk } })?.sources
    expect(risksOnly).toEqual({ places: new Set(), seismic: false, risks: new Set(['flood', 'clay', 'radon', 'cavities']) })
  })

  it('has no places when the layer or its kinds are missing', () => {
    const none = { places: new Set(), seismic: false, risks: new Set() }
    expect(parseOverlaysManifest({ ...manifest, layers: {} })?.sources).toEqual(none)
    expect(parseOverlaysManifest({ version: 'v', tiles: { file: 'f.pmtiles' } })?.sources).toEqual(none)
    expect(parseOverlaysManifest({ ...manifest, layers: { places: { kinds: [1, 2] } } })?.sources.places).toEqual(new Set())
  })

  it('is null for anything that is not an overlays manifest', () => {
    for (const value of [null, undefined, 'x', 3, [], {}, { version: 3, tiles: { file: 'f' } }, { version: 'v' }, { version: 'v', tiles: {} }, { version: 'v', tiles: { file: 4 } }]) {
      expect(parseOverlaysManifest(value), JSON.stringify(value)).toBeNull()
    }
  })

  it('resolves the archive next to the data base', () => {
    const parsed = parseOverlaysManifest(manifest)
    expect(parsed && overlaysTileUrl(parsed)).toBe(new URL('v2026-11-13/overlays.pmtiles', `${DATA_BASE}/`).toString())
  })
})

describe('loadOverlaysManifest', () => {
  afterEach(() => vi.unstubAllGlobals())

  const answer = (response: Response | Error) => {
    const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('asks the data host for overlays.json without trusting the cache, and reads the answer', async () => {
    const fetchMock = answer(Response.json({ version: 'v', tiles: { file: 'overlays.pmtiles' }, layers: { places: { kinds: { hos: 2 } } } }))
    const loaded = await loadOverlaysManifest()
    expect(fetchMock).toHaveBeenCalledWith(`${DATA_BASE}/overlays.json`, expect.objectContaining({ cache: 'no-cache' }))
    expect(loaded?.sources.places).toEqual(new Set(['hos']))
  })

  it('gives null, without throwing, for a 404, a network error, a page that is not JSON and a wrong shape', async () => {
    answer(new Response('', { status: 404 }))
    expect(await loadOverlaysManifest()).toBeNull()
    answer(new TypeError('Failed to fetch'))
    expect(await loadOverlaysManifest()).toBeNull()
    answer(new Response('<!doctype html>', { status: 200 }))
    expect(await loadOverlaysManifest()).toBeNull()
    answer(Response.json({ hello: 'world' }))
    expect(await loadOverlaysManifest()).toBeNull()
  })
})
