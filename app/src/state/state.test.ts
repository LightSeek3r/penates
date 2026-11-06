import { describe, expect, it } from 'vitest'
import { dictionaries, langFromPath, pathForLang } from '../i18n'
import { createStore } from './store'
import { DEFAULT_VIEW, formatHash, parseHash } from './urlState'

describe('url hash', () => {
  it('round-trips a state', () => {
    const state = { lng: 4.8351, lat: 45.758, zoom: 9.5, type: 'app', selected: '69123', theme: 'hospital', filters: { gp: 5000, seismic: 3 } } as const
    expect(parseHash(formatHash(state), 'en')).toEqual({ ...state, lang: 'en', viewProvided: true })
  })

  it('falls back to defaults on an empty or hostile hash', () => {
    const parsed = parseHash('#z=abc&lat=999&lng=-500&t=evil&c=<script>&l=xx', 'fr')
    expect(parsed).toEqual({ ...DEFAULT_VIEW, type: 'all', selected: null, lang: 'fr', theme: 'price', filters: {}, viewProvided: false })
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
      filters: { flood: 1, altitude: [200, 800], sunshine: 2000, rent: [8, 14] },
    } as const
    expect(parseHash(formatHash(state), 'fr')).toEqual({ ...state, lang: 'fr', viewProvided: true })
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
    expect(formatHash({ lng: 2, lat: 46, zoom: 5, type: 'all', selected: null, theme: 'price', filters: {} })).not.toContain('l=')
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
