import { describe, expect, it } from 'vitest'
import { dictionaries, langFromPath, pathForLang } from '../i18n'
import type { OverlaySources } from '../domain/overlays'
import { createStore } from './store'
import { DEFAULT_VIEW, formatHash, parseHash } from './urlState'

describe('url hash', () => {
  it('round-trips a state', () => {
    const state = { lng: 4.8351, lat: 45.758, zoom: 9.5, type: 'app', selected: '69123', theme: 'altitude', compare: null, mix: 'cross', filters: { gp: 5000, seismic: 3 }, overlays: ['seismic', 'hos'] } as const
    expect(parseHash(formatHash(state), 'en')).toEqual({ ...state, lang: 'en', viewProvided: true })
  })

  it('falls back to defaults on an empty or hostile hash', () => {
    const parsed = parseHash('#z=abc&lat=999&lng=-500&t=evil&c=<script>&l=xx', 'fr')
    expect(parsed).toEqual({ ...DEFAULT_VIEW, type: 'all', selected: null, lang: 'fr', theme: 'price', compare: null, mix: 'cross', filters: {}, overlays: [], viewProvided: false })
  })

  it('only treats a link as carrying a view when position and zoom are all present', () => {
    expect(parseHash('#l=en', 'fr').viewProvided).toBe(false)
    expect(parseHash('#lat=45&lng=4', 'fr').viewProvided).toBe(false)
    expect(parseHash('#z=9&lat=45&lng=4', 'fr').viewProvided).toBe(true)
  })

  it('opens links shared before the layer catalogue as before, the retired colour themes turning into overlays', () => {
    const parsed = parseHash('#z=6&lat=46.6&lng=2.4&th=hospital&f=gp-5000.seismic-3&l=fr', 'fr')
    expect(parsed).toMatchObject({ theme: 'price', filters: { gp: 5000, seismic: 3 }, overlays: ['hos'] })
    expect(formatHash(parsed)).toBe('#z=6.00&lat=46.6000&lng=2.4000&t=all&f=seismic-3.gp-5000&ov=hos')
    expect(parseHash('#th=seismic&f=price-3500.hospital-10000', 'fr')).toMatchObject({ theme: 'price', filters: { price: 3500, hospital: 10000 }, overlays: ['seismic'] })
    expect(parseHash('#th=sunshine&f=gp-5000', 'fr')).toMatchObject({ theme: 'sunshine', filters: { gp: 5000 }, overlays: [] })
  })

  it('turns every retired colour theme into its overlay, as the theme or as the second indicator', () => {
    const OVERLAY_OF = {
      seismic: 'seismic',
      flood: 'flood',
      clay: 'clay',
      radon: 'radon',
      cavities: 'cavities',
      hospital: 'hos',
      gp: 'gp',
      pharmacy: 'pha',
      dentist: 'den',
      creche: 'cre',
      school: 'pri',
      college: 'col',
      lycee: 'lyc',
      supermarket: 'sup',
      bakery: 'bak',
      post: 'pos',
      pool: 'pool',
      station: 'sta',
    }
    for (const [layer, overlay] of Object.entries(OVERLAY_OF)) {
      expect(parseHash('#th=' + layer, 'fr'), 'th=' + layer).toMatchObject({ theme: 'price', compare: null, overlays: [overlay] })
      expect(parseHash('#th2=' + layer + '&mix=marks', 'fr'), 'th2=' + layer).toMatchObject({ theme: 'price', compare: null, mix: 'marks', overlays: [overlay] })
    }
  })

  it('keeps a colour theme and a second indicator that are still themes, and adds the legacy overlays to ov', () => {
    expect(parseHash('#th=sunshine&th2=hospital&mix=marks&ov=flood', 'fr')).toMatchObject({ theme: 'sunshine', compare: null, mix: 'marks', overlays: ['flood', 'hos'] })
    expect(parseHash('#th=seismic&th2=price&ov=seismic,gp', 'fr')).toMatchObject({ theme: 'price', compare: null, overlays: ['seismic', 'gp'] })
    expect(parseHash('#th=hospital&th2=gp', 'fr')).toMatchObject({ theme: 'price', compare: null, overlays: ['hos', 'gp'] })
  })

  it('writes the overlays as a readable comma list, and nothing when there are none', () => {
    const base = parseHash('#z=6&lat=46.6&lng=2.4', 'fr')
    expect(formatHash({ ...base, overlays: ['seismic', 'hos', 'gp'] })).toBe('#z=6.00&lat=46.6000&lng=2.4000&t=all&ov=seismic,hos,gp')
    expect(formatHash({ ...base, overlays: [] })).not.toContain('ov=')
    expect(parseHash('#ov=seismic%2Chos', 'fr').overlays).toEqual(['seismic', 'hos'])
  })

  it('reads an overlay list in catalogue order, without repeats or unknown ids', () => {
    expect(parseHash('#ov=gp,hos,nope,gp,,seismic,cavities', 'fr').overlays).toEqual(['seismic', 'cavities', 'hos', 'gp'])
    expect(parseHash('#ov=', 'fr').overlays).toEqual([])
    expect(parseHash('#ov=<script>', 'fr').overlays).toEqual([])
  })

  it('round-trips the new themes and every filter kind', () => {
    const state = {
      lng: 2,
      lat: 46,
      zoom: 7,
      type: 'all',
      selected: null,
      theme: 'heat2050',
      compare: null,
      mix: 'cross',
      filters: { flood: 1, altitude: [200, 800], sunshine: 2000, rent: [8, 14] },
      overlays: ['flood', 'pool', 'lib'],
    } as const
    expect(parseHash(formatHash(state), 'fr')).toEqual({ ...state, lang: 'fr', viewProvided: true })
  })

  it('round-trips a second indicator and how it is drawn', () => {
    const state = { lng: 4.8, lat: 45.7, zoom: 9, type: 'all', selected: null, theme: 'price', compare: 'altitude', mix: 'marks', filters: { gp: 5000 }, overlays: [] } as const
    expect(formatHash(state)).toContain('th2=altitude&mix=marks')
    expect(parseHash(formatHash(state), 'fr')).toEqual({ ...state, lang: 'fr', viewProvided: true })
  })

  it('writes no mix without a second indicator, and ignores a junk or redundant one', () => {
    expect(formatHash({ ...parseHash('', 'fr'), mix: 'marks' })).not.toMatch(/th2|mix/)
    expect(parseHash('#th2=nope&mix=blend', 'fr')).toMatchObject({ compare: null, mix: 'cross' })
    expect(parseHash('#th=sunshine&th2=sunshine&mix=marks', 'fr')).toMatchObject({ theme: 'sunshine', compare: null, mix: 'marks' })
    expect(parseHash('#th2=price', 'fr').compare).toBeNull()
    expect(parseHash('#th=sunshine&th2=price', 'fr')).toMatchObject({ theme: 'sunshine', compare: 'price', mix: 'cross' })
  })

  it('accepts Corsican commune codes', () => {
    expect(parseHash('#c=2A004', 'fr').selected).toBe('2A004')
  })
})

describe('language', () => {
  it('takes the language from the path and ignores the hash', () => {
    expect(langFromPath('/')).toBe('fr')
    expect(langFromPath('/en/')).toBe('en')
    expect(langFromPath('/en')).toBe('en')
    expect(langFromPath('/environnement/')).toBe('fr')
    expect(parseHash('#l=en', 'fr').lang).toBe('fr')
  })

  it('never writes the language into the hash', () => {
    expect(formatHash({ lng: 2, lat: 46, zoom: 5, type: 'all', selected: null, theme: 'price', compare: null, mix: 'cross', filters: {}, overlays: [] })).not.toContain('l=')
  })

  it('maps a language to its page path', () => {
    expect(pathForLang('fr')).toBe('/')
    expect(pathForLang('en')).toBe('/en/')
  })

  it('keeps FR and EN dictionaries on exactly the same keys', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix]
    expect(keys(dictionaries.en).sort()).toEqual(keys(dictionaries.fr).sort())
  })
})

describe('opt-in layers', () => {
  const crimeLink = parseHash('#th=violence&f=burglary-3.gp-5000', 'fr')

  it('are dropped from a shared link until the visitor opts in', () => {
    const state = createStore(crimeLink, false).getState()
    expect(state.theme).toBe('price')
    expect(state.filters).toEqual({ gp: 5000 })
    expect(createStore(crimeLink, true).getState()).toMatchObject({ theme: 'violence', filters: { burglary: 3, gp: 5000 } })
  })

  it('cannot be chosen without opting in, and leave the map when the visitor opts out', () => {
    const saved: boolean[] = []
    const store = createStore(parseHash('', 'fr'), false, (show) => saved.push(show))
    store.getState().setTheme('violence')
    store.getState().setFilter('burglary', 3)
    expect(store.getState()).toMatchObject({ theme: 'price', filters: {} })
    store.getState().setShowOptIn(true)
    store.getState().setTheme('violence')
    store.getState().setFilter('burglary', 3)
    store.getState().setFilter('gp', 5000)
    expect(store.getState()).toMatchObject({ theme: 'violence', filters: { burglary: 3, gp: 5000 } })
    store.getState().setShowOptIn(false)
    expect(store.getState()).toMatchObject({ showOptIn: false, theme: 'price', filters: { gp: 5000 } })
    expect(saved).toEqual([true, false])
  })
})

describe('second indicator', () => {
  it('is refused when it is the theme, and removed with null', () => {
    const store = createStore(parseHash('#th=altitude', 'fr'))
    store.getState().setCompare('altitude')
    expect(store.getState().compare).toBeNull()
    store.getState().setCompare('price')
    store.getState().setMix('marks')
    expect(store.getState()).toMatchObject({ theme: 'altitude', compare: 'price', mix: 'marks' })
    store.getState().setCompare(null)
    expect(store.getState()).toMatchObject({ compare: null, mix: 'marks' })
  })

  it('swaps with the theme when the visitor colours the map by it', () => {
    const store = createStore(parseHash('#th=price&th2=altitude&mix=cross', 'fr'))
    store.getState().setTheme('altitude')
    expect(store.getState()).toMatchObject({ theme: 'altitude', compare: 'price' })
    store.getState().setTheme('sunshine')
    expect(store.getState()).toMatchObject({ theme: 'sunshine', compare: 'price' })
  })

  it('stays opt-in: dropped from a link and refused until the visitor opts in, dropped again on opting out', () => {
    expect(createStore(parseHash('#th2=violence&mix=marks', 'fr'), false).getState().compare).toBeNull()
    expect(createStore(parseHash('#th2=violence&mix=marks', 'fr'), true).getState().compare).toBe('violence')
    const store = createStore(parseHash('', 'fr'), false)
    store.getState().setCompare('burglary')
    expect(store.getState().compare).toBeNull()
    store.getState().setShowOptIn(true)
    store.getState().setCompare('burglary')
    expect(store.getState().compare).toBe('burglary')
    store.getState().setShowOptIn(false)
    expect(store.getState().compare).toBeNull()
  })

  it('is dropped when the tiles lack it, or when the theme falls back onto it', () => {
    const store = createStore(parseHash('#th=sunshine&th2=heat2050', 'fr'))
    store.getState().setTileFields(new Set(['code', 'p_all', 'sun']))
    expect(store.getState()).toMatchObject({ theme: 'sunshine', compare: null })
    store.getState().setCompare('heat2050')
    expect(store.getState().compare).toBeNull()

    const fallback = createStore(parseHash('#th=heat2050&th2=price', 'fr'))
    fallback.getState().setTileFields(new Set(['code', 'p_all']))
    expect(fallback.getState()).toMatchObject({ theme: 'price', compare: null })
  })
})

describe('layers the tiles lack', () => {
  it('fall back to price and lose their filters once the tile fields are known', () => {
    const store = createStore(parseHash('#th=heat2050&f=heat2050-10.gp-5000.sunshine-2000', 'fr'))
    expect(store.getState().theme).toBe('heat2050')
    store.getState().setTileFields(new Set(['code', 'p_all', 'd_gp', 'sun']))
    expect(store.getState()).toMatchObject({ theme: 'price', filters: { gp: 5000, sunshine: 2000 } })
    store.getState().setTheme('heat2050')
    store.getState().setFilter('heat2050', 10)
    expect(store.getState()).toMatchObject({ theme: 'price', filters: { gp: 5000, sunshine: 2000 } })
    store.getState().setTheme('sunshine')
    expect(store.getState().theme).toBe('sunshine')
  })
})

describe('layers that became overlays', () => {
  it('cannot be chosen as the colour theme or as a second indicator, but stay filters', () => {
    const store = createStore(parseHash('', 'fr'))
    // The setters are typed with the colour themes; a stale caller (a cast radio, an old link) still gets nothing.
    store.getState().setTheme('hospital' as never)
    store.getState().setCompare('seismic' as never)
    store.getState().setFilter('hospital', 10_000)
    store.getState().setFilter('seismic', 3)
    expect(store.getState()).toMatchObject({ theme: 'price', compare: null, filters: { hospital: 10_000, seismic: 3 } })
  })
})

describe('overlays', () => {
  const sources = (places: string[], seismic = true, risks: string[] = []): OverlaySources => ({ places: new Set(places), seismic, risks: new Set(risks) })
  const place = { kind: 'hos', name: 'Hopital Edouard Herriot', count: 1, approximate: false, lng: 4.84, lat: 45.74 } as const

  it('start as the link asked, before the archive is known', () => {
    const state = createStore(parseHash('#ov=seismic,hos,flood', 'fr')).getState()
    expect(state).toMatchObject({ overlays: ['seismic', 'flood', 'hos'], overlaySources: null, placeSelection: null })
  })

  it('switch on only what the data backs, keep catalogue order and ignore repeats', () => {
    const store = createStore(parseHash('', 'fr'))
    store.getState().setOverlay('hos', true)
    store.getState().setOverlay('seismic', true)
    expect(store.getState().overlays).toEqual([])
    store.getState().setOverlaySources(sources(['hos', 'gp'], true, ['flood']))
    store.getState().setOverlay('gp', true)
    store.getState().setOverlay('flood', true)
    store.getState().setOverlay('seismic', true)
    store.getState().setOverlay('hos', true)
    store.getState().setOverlay('hos', true)
    store.getState().setOverlay('pha', true)
    expect(store.getState().overlays).toEqual(['seismic', 'flood', 'hos', 'gp'])
    store.getState().setOverlay('flood', false)
    store.getState().setOverlay('cin', false)
    expect(store.getState().overlays).toEqual(['seismic', 'hos', 'gp'])
  })

  it('refuse a risk the archive has no lines for, and drop it when the manifest turns out to lack it', () => {
    const store = createStore(parseHash('#ov=flood,clay,radon', 'fr'))
    store.getState().setOverlaySources(sources([], true, ['flood', 'radon', 'cavities']))
    expect(store.getState().overlays).toEqual(['flood', 'radon'])
    store.getState().setOverlay('clay', true)
    expect(store.getState().overlays).toEqual(['flood', 'radon'])
    store.getState().setOverlay('cavities', true)
    expect(store.getState().overlays).toEqual(['flood', 'radon', 'cavities'])
    store.getState().setOverlaySources(sources([], true, ['radon']))
    expect(store.getState().overlays).toEqual(['radon'])
  })

  it('drop every overlay the manifest lacks, risks included, and keep the list of a link until the manifest is known', () => {
    const store = createStore(parseHash('#ov=seismic,flood,hos,gp', 'fr'))
    expect(store.getState().overlays).toEqual(['seismic', 'flood', 'hos', 'gp'])
    store.getState().setOverlaySources(sources(['hos'], false))
    expect(store.getState().overlays).toEqual(['hos'])
    store.getState().setOverlaySources(null)
    expect(store.getState().overlays).toEqual([])
  })

  it('leave the overlays alone when the communes tile fields arrive, whichever comes first', () => {
    const store = createStore(parseHash('#ov=flood,clay,hos', 'fr'))
    store.getState().setTileFields(new Set(['code', 'p_all']))
    expect(store.getState().overlays).toEqual(['flood', 'clay', 'hos'])
    store.getState().setOverlaySources(sources(['hos'], true, ['flood', 'clay']))
    expect(store.getState().overlays).toEqual(['flood', 'clay', 'hos'])
    store.getState().setTileFields(new Set(['code']))
    expect(store.getState().overlays).toEqual(['flood', 'clay', 'hos'])
  })

  it('clear in one go', () => {
    const store = createStore(parseHash('#ov=seismic,flood,hos', 'fr'))
    store.getState().selectPlace(place)
    store.getState().clearOverlays()
    expect(store.getState()).toMatchObject({ overlays: [], placeSelection: null })
  })

  it('keep a clicked dot apart from the commune selection, only while its overlay is on', () => {
    const store = createStore(parseHash('#ov=hos,gp', 'fr'))
    store.getState().setOverlaySources(sources(['hos', 'gp']))
    store.getState().select({ kind: 'commune', props: { code: '69123' } })
    store.getState().selectPlace(place)
    expect(store.getState()).toMatchObject({ placeSelection: place, selection: { kind: 'commune', props: { code: '69123' } } })
    store.getState().setOverlay('gp', false)
    expect(store.getState().placeSelection).toEqual(place)
    store.getState().setOverlay('hos', false)
    expect(store.getState().placeSelection).toBeNull()
    store.getState().setOverlay('hos', true)
    store.getState().selectPlace(place)
    store.getState().setOverlaySources(sources(['gp']))
    expect(store.getState()).toMatchObject({ overlays: [], placeSelection: null })
    store.getState().selectPlace(null)
    expect(store.getState().placeSelection).toBeNull()
  })
})
