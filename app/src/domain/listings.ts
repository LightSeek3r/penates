/**
 * Search pages on third-party listing portals, pre-filtered on one commune (sale, houses and flats).
 *
 * The portals own these URL formats and none of them is a documented API, so each portal is one entry in
 * PORTALS: when one breaks, fix or drop that entry. Portals whose search needs a private geographic id that
 * cannot be derived from the INSEE or postal code (PAP, Logic-Immo, Immonot) are deliberately absent.
 */

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
  url: (place: ListingPlace) => string | null
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

/**
 * SeLoger's commune key: department, a zero, then the three last digits of the INSEE code (35238 becomes 350238).
 * Corsica (2A, 2B) and overseas codes do not follow that rule, so they get no SeLoger link.
 */
export function selogerKey(code: string): string | null {
  return /^\d{5}$/.test(code) && Number(code.slice(0, 2)) < 96 ? `${code.slice(0, 2)}0${code.slice(2)}` : null
}

const PORTALS: readonly Portal[] = [
  {
    id: 'bienici',
    label: "Bien'ici",
    url: ({ name, postalCode }) => `https://www.bienici.com/recherche/achat/${slugOf(searchName(name))}-${postalCode}/maisonvilla,appartement`,
  },
  {
    id: 'leboncoin',
    label: 'Leboncoin',
    url: ({ name, postalCode }) =>
      `https://www.leboncoin.fr/recherche?category=9&real_estate_type=1,2&locations=${encodeURIComponent(`${searchName(name)}_${postalCode}`)}`,
  },
  {
    id: 'seloger',
    label: 'SeLoger',
    url: ({ code }) => {
      const key = selogerKey(code)
      return key ? `https://www.seloger.com/list.htm?projects=2&types=1,2&places=${encodeURIComponent(`[{"inseeCodes":[${key}]}]`)}` : null
    },
  },
]

/** One link per portal that can be searched for this place, in a fixed alphabetical order (no ranking). */
export function listingLinks(place: ListingPlace): ListingLink[] {
  if (!/^\d{5}$/.test(place.postalCode) || place.name.trim() === '') return []
  return PORTALS.flatMap((portal) => {
    const url = portal.url(place)
    return url ? [{ portal: portal.id, label: portal.label, url }] : []
  })
}
