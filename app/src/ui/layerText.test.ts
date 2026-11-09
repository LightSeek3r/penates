import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { dictionaries } from '../i18n'
import { type LayerDef, layerById, layerColors } from '../domain/layers'
import { type Translate, filterValueText, formatLayerValue, legendRows, tierLabels } from './layerText'

let t: Translate
// French groups digits with a narrow no-break space; compare with plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ')

const def = (id: string): LayerDef => {
  const found = layerById(id)
  if (!found) throw new Error(id)
  return found
}
const labels = (id: string) => legendRows(t, def(id), layerColors(def(id)), 'fr').map((row) => plain(row.label))
const shorts = (id: string) => legendRows(t, def(id), layerColors(def(id)), 'fr').map((row) => plain(row.short))

beforeAll(async () => {
  const instance = i18next.createInstance()
  await instance.init({ resources: { fr: { translation: dictionaries.fr } }, lng: 'fr', interpolation: { escapeValue: false } })
  t = instance.t as unknown as Translate
})

describe('legend rows', () => {
  it('keep the price and distance wording of the first release', () => {
    expect(labels('price')).toEqual(['moins de 1 000', '1 000 à 1 500', '1 500 à 2 000', '2 000 à 2 500', '2 500 à 3 500', '3 500 à 5 000', '5 000 et plus'])
    expect(labels('hospital')).toEqual(['moins de 1 km', '1 à 2 km', '2 à 5 km', '5 à 10 km', '10 à 20 km', '20 km et plus'])
    expect(shorts('hospital')).toEqual(['<1', '1', '2', '5', '10', '20+'])
    expect(labels('seismic')[2]).toBe('Zone 3 : modérée')
  })

  it('name each class and count whole numbers', () => {
    expect(labels('flood')).toEqual([
      'Étape 0 : aucune démarche recensée',
      'Étape 1 : atlas des zones inondables ou DDRM seulement',
      'Étape 2 : plan de prévention prescrit',
      'Étape 3 : plan de prévention approuvé',
    ])
    expect(labels('cavities')).toEqual(['0', '1', '2 à 4', '5 à 9', '10 à 24', '25 et plus'])
    expect(shorts('cavities')[0]).toBe('0')
    expect(labels('sunshine')[0]).toBe('moins de 1 700 h/an')
    expect(shorts('sunshine').slice(0, 2)).toEqual(['<1 700', '1 700'])
    expect(shorts('price')[1]).toBe('1 k')
    expect(labels('rent').at(-1)).toBe('20 €/m²/mois et plus')
  })
})

describe('filter read-outs', () => {
  it('say what each kind keeps', () => {
    expect(plain(filterValueText(t, def('hospital'), 10_000, 'fr'))).toBe("jusqu'à 10 km")
    expect(plain(filterValueText(t, def('price'), 3500, 'fr'))).toBe("jusqu'à 3 500 €/m²")
    expect(filterValueText(t, def('seismic'), 3, 'fr')).toBe('zone 3 au plus')
    expect(filterValueText(t, def('flood'), 1, 'fr')).toBe('étape 1 au plus')
    expect(plain(filterValueText(t, def('sunshine'), 2000, 'fr'))).toBe('au moins 2 000 h/an')
    expect(filterValueText(t, def('altitude'), [200, 800], 'fr')).toBe('200 à 800 m')
    expect(filterValueText(t, def('altitude'), [0, 800], 'fr')).toBe("jusqu'à 800 m")
    expect(filterValueText(t, def('altitude'), [200, 2000], 'fr')).toBe('à partir de 200 m')
    expect(filterValueText(t, def('fibre'), undefined, 'fr')).toBe('Sans limite')
  })
})

describe('details values', () => {
  it('carry their unit and class name', () => {
    expect(formatLayerValue(t, def('seismic'), 3, 'fr')).toBe('3 (modérée)')
    expect(formatLayerValue(t, def('hospital'), 1200, 'fr')).toBe('1,2 km')
    expect(formatLayerValue(t, def('rent'), 12.5, 'fr')).toBe('12,5 €/m²/mois')
    expect(plain(formatLayerValue(t, def('violence'), 3.2, 'fr'))).toBe('3,2 pour 1 000 hab.')
    // Burglaries are counted against dwellings, offences against persons against residents.
    expect(plain(formatLayerValue(t, def('burglary'), 4.1, 'fr'))).toBe('4,1 pour 1 000 logements')
  })
})

describe('tier labels of a combined layer', () => {
  const tiers = (id: string) => Object.values(tierLabels(t, def(id), 'fr')).map((tier) => ({ label: plain(tier.label), short: plain(tier.short) }))

  it('reuse the legend wording and units on the tier cuts', () => {
    expect(tiers('price').map((tier) => tier.label)).toEqual(['moins de 1 500', '1 500 à 3 500', '3 500 et plus'])
    expect(tiers('hospital').map((tier) => tier.label)).toEqual(['moins de 2 km', '2 à 10 km', '10 km et plus'])
    expect(tiers('hospital').map((tier) => tier.short)).toEqual(['<2', '2', '10+'])
    expect(tiers('cavities').map((tier) => tier.label)).toEqual(['0', '1 à 4', '5 et plus'])
  })

  it('name the class codes of each tier', () => {
    expect(tiers('seismic')).toEqual([
      { label: 'zone 1 à 2', short: '1–2' },
      { label: 'zone 3', short: '3' },
      { label: 'zone 4 à 5', short: '4–5' },
    ])
    expect(tiers('radon').map((tier) => tier.label)).toEqual(['catégorie 1', 'catégorie 2', 'catégorie 3'])
  })
})
