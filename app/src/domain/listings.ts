/**
 * Search pages on third-party listing portals, pre-filtered on one commune (sale; houses, flats or both).
 *
 * The portals own these URL formats and none of them is a documented API, so each portal is one entry in
 * PORTALS: when one breaks, fix or drop that entry. Portals whose search needs a private geographic id that
 * cannot be derived from the INSEE or postal code (PAP, Logic-Immo, Immonot) are deliberately absent. SeLoger's
 * location id is private too, so its link only pre-fills the search bar with the commune name (`prefill`).
 */

import type { PriceType } from './place'

export interface ListingPlace {
  /** INSEE commune code, or municipal-arrondissement code for Paris, Lyon and Marseille. */
  code: string
  name: string
  postalCode: string
}

export interface ListingLink {
  portal: string
  label: string
  url: string
  /** The portal opens its own search with the commune typed in, but the visitor still has to run it. */
  prefill: boolean
}

interface Portal {
  id: string
  label: string
  prefill?: boolean
  /** Null when the portal cannot be searched for this place. */
  url: (place: ListingPlace, type: PriceType) => string | null
}

/** "Paris 1er Arrondissement" is searched as "Paris": portals know the city plus the postal code. */
export function searchName(name: string): string {
  return name.replace(/\s+\d+(?:er|e|ème)\s+arrondissement$/i, '').trim()
}

/** Lower-case, unaccented, hyphen-separated: "L'Haÿ-les-Roses" becomes "l-hay-les-roses". */
export function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const BIENICI_TYPES: Record<PriceType, string> = { all: 'maisonvilla,appartement', mai: 'maisonvilla', app: 'appartement' }
// Leboncoin's real_estate_type: 1 is a house, 2 a flat.
const LEBONCOIN_TYPES: Record<PriceType, string> = { all: '1,2', mai: '1', app: '2' }

// SeLoger's estateTypes: omitted for both, since only the single-type values are known to work.
const SELOGER_TYPES: Record<PriceType, string> = { all: '', mai: '&estateTypes=House', app: '&estateTypes=Apartment' }
const ZIMO_TYPES: Record<PriceType, string> = { all: '', mai: 'maison/', app: 'appartement/' }

const PORTALS: readonly Portal[] = [
  {
    id: 'bienici',
    label: "Bien'ici",
    url: ({ name, postalCode }, type) => `https://www.bienici.com/recherche/achat/${slugOf(searchName(name))}-${postalCode}/${BIENICI_TYPES[type]}`,
  },
  {
    id: 'leboncoin',
    label: 'Leboncoin',
    url: ({ name, postalCode }, type) =>
      `https://www.leboncoin.fr/recherche?category=9&real_estate_type=${LEBONCOIN_TYPES[type]}&locations=${encodeURIComponent(`${searchName(name)}_${postalCode}`)}`,
  },
  {
    id: 'seloger',
    label: 'SeLoger',
    prefill: true,
    url: ({ name }, type) => `https://www.seloger.com/classified-search?distributionTypes=Buy${SELOGER_TYPES[type]}&initialQuery=${encodeURIComponent(searchName(name))}&method=text`,
  },
  {
    id: 'zimo',
    label: 'Zimo',
    // Zimo gathers listings from several portals; /vente/maison/ is confirmed, the flat and all-types paths follow by analogy.
    url: ({ name, postalCode }, type) => `https://www.zimo.fr/annonces/immobilier/vente/${ZIMO_TYPES[type]}${slugOf(searchName(name))}-${postalCode}`,
  },
]

/** One link per portal that can be searched for this place, in a fixed alphabetical order (no ranking). */
export function listingLinks(place: ListingPlace, type: PriceType = 'all'): ListingLink[] {
  if (!/^\d{5}$/.test(place.postalCode) || place.name.trim() === '') return []
  return PORTALS.flatMap((portal) => {
    const url = portal.url(place, type)
    return url ? [{ portal: portal.id, label: portal.label, url, prefill: portal.prefill === true }] : []
  })
}
