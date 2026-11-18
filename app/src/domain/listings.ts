/**
 * Search pages on third-party listing portals, pre-filtered on one commune (sale; houses, flats or both).
 *
 * The portals own these URL formats and none of them is a documented API, so each portal is one entry in
 * PORTALS: when one breaks, fix or drop that entry. Portals whose search needs a private geographic id that
 * cannot be derived from the INSEE or postal code (PAP, Logic-Immo, Immonot, SeLoger) are deliberately absent.
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
}

interface Portal {
  id: string
  label: string
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
]

/** One link per portal that can be searched for this place, in a fixed alphabetical order (no ranking). */
export function listingLinks(place: ListingPlace, type: PriceType = 'all'): ListingLink[] {
  if (!/^\d{5}$/.test(place.postalCode) || place.name.trim() === '') return []
  return PORTALS.flatMap((portal) => {
    const url = portal.url(place, type)
    return url ? [{ portal: portal.id, label: portal.label, url }] : []
  })
}
