import i18next, { type i18n } from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { GROUPS, LAYERS } from '../domain/layers'
import { dictionaries } from '../i18n'
import { CREDITS, SourceCredits } from './SourceCredits'
import licencesEn from '../../../docs/data-licences.md?raw'
import licencesFr from '../../../docs/data-licences.fr.md?raw'
import methodologyEn from '../../../docs/methodology.md?raw'
import methodologyFr from '../../../docs/methodology.fr.md?raw'

type Lang = keyof typeof dictionaries

const instances = {} as Record<Lang, i18n>
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const all = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'g'))].map((match) => decode(match[1]))
const render = (lang: Lang) => renderToStaticMarkup(createElement(I18nextProvider, { i18n: instances[lang] }, createElement(SourceCredits)))
const DOCS: Record<string, string> = {
  'methodology.md': methodologyEn,
  'methodology.fr.md': methodologyFr,
  'data-licences.md': licencesEn,
  'data-licences.fr.md': licencesFr,
}
const doc = (name: string) => DOCS[name]

beforeAll(async () => {
  for (const lang of ['fr', 'en'] as const) {
    const instance = i18next.createInstance().use(initReactI18next)
    await instance.init({ resources: { [lang]: { translation: dictionaries[lang] } }, lng: lang, interpolation: { escapeValue: false } })
    instances[lang] = instance
  }
})

describe('source credits', () => {
  it('give every theme group of the catalogue a credit, in theme order, then the basemap', () => {
    expect(CREDITS.map((credit) => credit.group)).toEqual([...GROUPS, 'basemap'])
    const lines = CREDITS.flatMap((credit) => [...credit.lines])
    expect(new Set(lines).size).toBe(lines.length)
  })

  it.each(['fr', 'en'] as const)('render one labelled, grouped list with every line translated in %s', (lang) => {
    const html = render(lang)
    expect(html).toContain('<section aria-labelledby="credits-title"><h3 id="credits-title"')
    expect(html.match(/<dl/g)).toHaveLength(1)
    expect(all(html, 'dt')).toHaveLength(CREDITS.length)
    const lines = all(html, 'dd')
    expect(lines).toHaveLength(CREDITS.flatMap((credit) => credit.lines).length)
    for (const text of [...all(html, 'dt'), ...lines]) {
      expect(text, 'untranslated key').not.toMatch(/^sources\./)
      expect(text.trim()).not.toBe('')
    }
  })

  it.each(['fr', 'en'] as const)('carry the wording each licence asks for in %s', (lang) => {
    const lines = all(render(lang), 'dd')
    const line = (needle: string) => lines.find((text) => text.includes(needle))
    // The rent credit is imposed verbatim, in French, whatever the interface language.
    expect(line('Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin')).toBeDefined()
    expect(line(lang === 'fr' ? 'Source : Arcep' : 'Source: Arcep')).toBeDefined()
    expect(line(lang === 'fr' ? 'Source : Insee' : 'Source: INSEE')).toBeDefined()
    expect(line('© OpenStreetMap contributors')).toBeDefined()
    expect(line('ASNR')).toContain('Licence Ouverte v1.0')
    for (const publisher of ['DGFiP / Etalab', 'IGN', 'Géorisques', 'GASPAR', 'BRGM', 'RGE ALTI', 'Météo-France', 'SSMSI', 'REI']) {
      expect(line(publisher), publisher).toBeDefined()
    }
  })

  it('keeps the Alsace-Moselle notice the only mention of the uncovered départements in the dialog', () => {
    for (const lang of ['fr', 'en'] as const) {
      const sources = dictionaries[lang].sources as Record<string, unknown>
      const mentions = Object.entries(sources).filter(([, value]) => JSON.stringify(value).match(/Alsace|57, 67, 68/))
      expect(mentions.map(([key]) => key)).toEqual(['limits'])
    }
  })
})

describe('documentation pages', () => {
  const outline = (markdown: string) => markdown.split('\n').filter((line) => /^#{1,3} /.test(line)).map((line) => line.split(' ')[0])
  const tableRows = (markdown: string) => markdown.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).length

  it('have the same outline and tables in French and English', () => {
    expect(outline(doc('methodology.fr.md'))).toEqual(outline(doc('methodology.md')))
    expect(outline(doc('methodology.md')).filter((level) => level === '#')).toHaveLength(1)
    expect(tableRows(doc('methodology.fr.md'))).toBe(tableRows(doc('methodology.md')))
    expect(tableRows(doc('data-licences.fr.md'))).toBe(tableRows(doc('data-licences.md')))
  })

  it.each(['methodology.md', 'methodology.fr.md'])('%s documents every tile property the catalogue reads', (name) => {
    const text = doc(name)
    const properties = LAYERS.map((def) => def.property).filter((property) => !property.includes('{type}'))
    for (const property of [...properties, 'cd', 'rtq']) expect(text, property).toContain(`\`${property}\``)
  })

  it.each(['data-licences.md', 'data-licences.fr.md'])('%s registers every credited publisher', (name) => {
    const text = doc(name)
    for (const publisher of ['DGFiP', 'IGN', 'Géorisques', 'GASPAR', 'BRGM', 'ASNR', 'RGE ALTI', 'Météo-France', 'BPE 2025', 'Arcep', 'SSMSI', 'ANIL', 'REI', 'OpenStreetMap']) {
      expect(text, publisher).toContain(publisher)
    }
    expect(text).toContain('« Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin »')
    expect(text).toContain('« Source : Arcep »')
  })
})
