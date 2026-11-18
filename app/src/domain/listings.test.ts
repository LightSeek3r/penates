import { describe, expect, it } from 'vitest'
import { listingLinks, searchName, slugOf } from './listings'

describe('listing links', () => {
  it('slugs a name the way portals do', () => {
    expect(slugOf("L'Haÿ-les-Roses")).toBe('l-hay-les-roses')
    expect(slugOf('Saint-Étienne')).toBe('saint-etienne')
    expect(slugOf('Œuilly')).toBe('oeuilly')
  })

  it('searches an arrondissement by its city', () => {
    expect(searchName('Paris 1er Arrondissement')).toBe('Paris')
    expect(searchName('Lyon 3e Arrondissement')).toBe('Lyon')
    expect(searchName('Marseille 13e Arrondissement')).toBe('Marseille')
    expect(searchName('Rennes')).toBe('Rennes')
  })

  it('builds one link per portal, alphabetical', () => {
    const links = listingLinks({ code: '35238', name: 'Rennes', postalCode: '35000' })
    expect(links.map((link) => link.label)).toEqual(["Bien'ici", 'Leboncoin'])
    expect(links[0].url).toBe('https://www.bienici.com/recherche/achat/rennes-35000/maisonvilla,appartement')
    expect(links[1].url).toContain('locations=Rennes_35000')
    expect(links[1].url).toContain('real_estate_type=1,2')
  })

  it('narrows the search to houses or flats', () => {
    const place = { code: '35238', name: 'Rennes', postalCode: '35000' }
    const [houseBienici, houseLeboncoin] = listingLinks(place, 'mai')
    const [flatBienici, flatLeboncoin] = listingLinks(place, 'app')
    expect(houseBienici.url.endsWith('/maisonvilla')).toBe(true)
    expect(houseLeboncoin.url).toContain('real_estate_type=1&')
    expect(flatBienici.url.endsWith('/appartement')).toBe(true)
    expect(flatLeboncoin.url).toContain('real_estate_type=2&')
  })

  it('encodes names with spaces and accents', () => {
    const [, leboncoin] = listingLinks({ code: '42218', name: 'Saint-Étienne', postalCode: '42000' })
    expect(leboncoin.url).toContain('locations=Saint-%C3%89tienne_42000')
  })

  it('gives nothing without a usable postal code or name', () => {
    expect(listingLinks({ code: '35238', name: 'Rennes', postalCode: '' })).toEqual([])
    expect(listingLinks({ code: '35238', name: 'Rennes', postalCode: '3500' })).toEqual([])
    expect(listingLinks({ code: '35238', name: ' ', postalCode: '35000' })).toEqual([])
  })
})
