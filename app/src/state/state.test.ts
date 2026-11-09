import { describe, expect, it } from 'vitest'
import { dictionaries, langFromPath, pathForLang } from '../i18n'
import { createStore } from './store'
import { DEFAULT_VIEW, formatHash, parseHash } from './urlState'

describe('url hash', () => {
  it('round-trips a state', () => {
    const state = { lng: 4.8351, lat: 45.758, zoom: 9.5, type: 'app', selected: '69123', theme: 'hospital', compare: null, mix: 'cross', filters: { gp: 5000, seismic: 3 } } as const
    expect(parseHash(formatHash(state), 'en')).toEqual({ ...state, lang: 'en', viewProvided: true })
  })

  it('falls back to defaults on an empty or hostile hash', () => {
    const parsed = parseHash('#z=abc&lat=999&lng=-500&t=evil&c=<script>&l=xx', 'fr')
    expect(parsed).toEqual({ ...DEFAULT_VIEW, type: 'all', selected: null, lang: 'fr', theme: 'price', compare: null, mix: 'cross', filters: {}, viewProvided: false })
  })

  it('only treats a link as carrying a view when position and zoom are all present', () => {
    expect(parseHash('#l=en', 'fr').viewProvided).toBe(false)
    expect(parseHash('#lat=45&lng=4', 'fr').viewProvided).toBe(false)
    expect(parseHash('#z=9&lat=45&lng=4', 'fr').viewProvided).toBe(true)
  })

  it('opens links shared before the layer catalogue exactly as before', () => {
    const parsed = parseHash('#z=6&lat=46.6&lng=2.4&th=hospital&f=gp-5000.seismic-3&l=fr', 'fr')
    expect(parsed).toMatchObject({ theme: 'hospital', filters: { gp: 5000, seismic: 3 } })
    expect(formatHash(parsed)).toBe('#z=6.00&lat=46.6000&lng=2.4000&t=all&th=hospital&f=seismic-3.gp-5000')
    expect(parseHash('#th=seismic&f=price-3500.hospital-10000', 'fr')).toMatchObject({ theme: 'seismic', filters: { price: 3500, hospital: 10000 } })
  })

  it('round-trips the new themes and every filter kind', () => {
    const state = {
      lng: 2,
      lat: 46,
      zoom: 7,
      type: 'all',
      selected: null,
      theme: 'flood',
      compare: null,
      mix: 'cross',
      filters: { flood: 1, altitude: [200, 800], sunshine: 2000, rent: [8, 14] },
    } as const
    expect(parseHash(formatHash(state), 'fr')).toEqual({ ...state, lang: 'fr', viewProvided: true })
  })

  it('round-trips a second indicator and how it is drawn', () => {
    const state = { lng: 4.8, lat: 45.7, zoom: 9, type: 'all', selected: null, theme: 'price', compare: 'hospital', mix: 'marks', filters: { gp: 5000 } } as const
    expect(formatHash(state)).toContain('th2=hospital&mix=marks')
    expect(parseHash(formatHash(state), 'fr')).toEqual({ ...state, lang: 'fr', viewProvided: true })
  })

  it('writes no mix without a second indicator, and ignores a junk or redundant one', () => {
    expect(formatHash({ ...parseHash('', 'fr'), mix: 'marks' })).not.toMatch(/th2|mix/)
    expect(parseHash('#th2=nope&mix=blend', 'fr')).toMatchObject({ compare: null, mix: 'cross' })
    expect(parseHash('#th=seismic&th2=seismic&mix=marks', 'fr')).toMatchObject({ theme: 'seismic', compare: null, mix: 'marks' })
    expect(parseHash('#th2=price', 'fr').compare).toBeNull()
    expect(parseHash('#th=gp&th2=price', 'fr')).toMatchObject({ theme: 'gp', compare: 'price', mix: 'cross' })
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
    expect(formatHash({ lng: 2, lat: 46, zoom: 5, type: 'all', selected: null, theme: 'price', compare: null, mix: 'cross', filters: {} })).not.toContain('l=')
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
    const store = createStore(parseHash('#th=hospital', 'fr'))
    store.getState().setCompare('hospital')
    expect(store.getState().compare).toBeNull()
    store.getState().setCompare('price')
    store.getState().setMix('marks')
    expect(store.getState()).toMatchObject({ theme: 'hospital', compare: 'price', mix: 'marks' })
    store.getState().setCompare(null)
    expect(store.getState()).toMatchObject({ compare: null, mix: 'marks' })
  })

  it('swaps with the theme when the visitor colours the map by it', () => {
    const store = createStore(parseHash('#th=price&th2=hospital&mix=cross', 'fr'))
    store.getState().setTheme('hospital')
    expect(store.getState()).toMatchObject({ theme: 'hospital', compare: 'price' })
    store.getState().setTheme('seismic')
    expect(store.getState()).toMatchObject({ theme: 'seismic', compare: 'price' })
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
    const store = createStore(parseHash('#th=gp&th2=heat2050', 'fr'))
    store.getState().setTileFields(new Set(['code', 'p_all', 'd_gp']))
    expect(store.getState()).toMatchObject({ theme: 'gp', compare: null })
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

