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
    expect(links.map((link) => link.label)).toEqual(["Bien'ici", 'Leboncoin', 'SeLoger', 'Zimo'])
    expect(links[0].url).toBe('https://www.bienici.com/recherche/achat/rennes-35000/maisonvilla,appartement')
    expect(links[1].url).toContain('locations=Rennes_35000')
    expect(links[1].url).toContain('real_estate_type=1,2')
    expect(links[3].url).toBe('https://www.zimo.fr/annonces/immobilier/vente/rennes-35000')
  })

  it('pre-fills SeLoger with the commune name and says so', () => {
    const links = listingLinks({ code: '35238', name: 'Rennes', postalCode: '35000' }, 'mai')
    const seloger = links.find((link) => link.portal === 'seloger')
    expect(seloger?.url).toBe('https://www.seloger.com/classified-search?distributionTypes=Buy&estateTypes=House&initialQuery=Rennes%20maison&method=text')
    expect(seloger?.prefill).toBe(true)
    expect(links.filter((link) => link.portal !== 'seloger').every((link) => !link.prefill)).toBe(true)
    expect(listingLinks({ code: '75101', name: 'Paris 1er Arrondissement', postalCode: '75001' }).find((link) => link.portal === 'seloger')?.url).toContain('initialQuery=Paris&')
  })

  it('names the type in the SeLoger text so pressing enter keeps it', () => {
    const place = { code: '74298', name: 'Vétraz-Monthoux', postalCode: '74100' }
    const url = (type: 'all' | 'mai' | 'app') => listingLinks(place, type).find((link) => link.portal === 'seloger')?.url
    expect(url('app')).toBe('https://www.seloger.com/classified-search?distributionTypes=Buy&estateTypes=Apartment&initialQuery=V%C3%A9traz-Monthoux%20appartement&method=text')
    expect(url('all')).toContain('initialQuery=V%C3%A9traz-Monthoux&')
  })

  it('narrows the search to houses or flats', () => {
    const place = { code: '35238', name: 'Rennes', postalCode: '35000' }
    const [houseBienici, houseLeboncoin, , houseZimo] = listingLinks(place, 'mai')
    const [flatBienici, flatLeboncoin, flatSeloger, flatZimo] = listingLinks(place, 'app')
    expect(houseBienici.url.endsWith('/maisonvilla')).toBe(true)
    expect(houseLeboncoin.url).toContain('real_estate_type=1&')
    expect(flatBienici.url.endsWith('/appartement')).toBe(true)
    expect(flatLeboncoin.url).toContain('real_estate_type=2&')
    expect(houseZimo.url).toBe('https://www.zimo.fr/annonces/immobilier/vente/maison/rennes-35000')
    expect(flatZimo.url).toBe('https://www.zimo.fr/annonces/immobilier/vente/appartement/rennes-35000')
    expect(flatSeloger.url).toContain('estateTypes=Apartment')
  })

  it('encodes names with spaces and accents', () => {
    const [, leboncoin, , zimo] = listingLinks({ code: '42218', name: 'Saint-Étienne', postalCode: '42000' })
    expect(leboncoin.url).toContain('locations=Saint-%C3%89tienne_42000')
    expect(zimo.url.endsWith('/saint-etienne-42000')).toBe(true)
  })

  it('gives nothing without a usable postal code or name', () => {
    expect(listingLinks({ code: '35238', name: 'Rennes', postalCode: '' })).toEqual([])
    expect(listingLinks({ code: '35238', name: 'Rennes', postalCode: '3500' })).toEqual([])
    expect(listingLinks({ code: '35238', name: ' ', postalCode: '35000' })).toEqual([])
  })
})
