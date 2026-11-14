import { describe, expect, it } from 'vitest'
import { layerById } from '../domain/layers'
import { OVERLAY_GROUPS, OVERLAYS, RISK_LINES, RISK_OVERLAYS, SEISMIC_LEVELS, isPlaceKind } from '../domain/overlays'
import { dictionaries } from '../i18n'

const lookup = (dictionary: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dictionary)

describe.each(['fr', 'en'] as const)('overlay strings in %s', (lang) => {
  const text = (key: string) => lookup(dictionaries[lang], key)

  it('name and explain every overlay, and give each place kind its singular for the card', () => {
    for (const def of OVERLAYS) {
      const keys = [`ov.${def.id}.name`, `ov.${def.id}.about`, ...(isPlaceKind(def.id) ? [`ov.${def.id}.one`] : [])]
      for (const key of keys) expect(text(key), key).toMatch(/\S/)
    }
    const listed = Object.keys(text('ov') as object)
    expect(listed.sort()).toEqual(OVERLAYS.map((def) => def.id).sort())
  })

  it('title every overlay group', () => {
    for (const group of OVERLAY_GROUPS) expect(text(`overlays.groups.${group}`), group).toMatch(/\S/)
  })

  it('keep the swimming-pool caveat and the official risk statement in view', () => {
    expect(text('ov.pool.about')).toMatch(lang === 'fr' ? /privées/ : /private/)
    expect(text('overlays.notes.risk')).toContain('ERRIAL')
  })

  it('describe every risk as lines that follow commune borders, never as outlined communes', () => {
    const lines = lang === 'fr' ? /ligne/i : /line/i
    const outlines = lang === 'fr' ? /entour|contour/i : /outline/i
    const borders = lang === 'fr' ? /limites des communes/ : /commune borders/
    for (const id of RISK_OVERLAYS) {
      expect(text(`ov.${id}.about`), id).toMatch(lines)
      expect(text(`ov.${id}.about`), id).not.toMatch(outlines)
    }
    // The four commune-level risks add that a commune at the edge may be only partly affected; the seismic text says it once in the key.
    for (const id of Object.keys(RISK_LINES)) expect(text(`ov.${id}.about`), id).toMatch(borders)
    expect(text('overlays.notes.risk')).not.toMatch(outlines)
    expect(text('overlays.notes.risk')).toMatch(borders)
  })

  it('say once in the key what a line is, that a commune at the edge may be partly affected, and that no data is never a lower level', () => {
    const meaning = String(text('legend.riskMeaning'))
    expect(meaning).toMatch(lang === 'fr' ? /ligne.*niveau indiqué/ : /line marks where.*level shown/)
    expect(meaning).toMatch(lang === 'fr' ? /au bord peut n'être touchée qu'en partie/ : /at the edge may be only partly affected/)
    expect(meaning).toMatch(lang === 'fr' ? /sans donnée n'est jamais comptée comme un niveau plus bas/ : /no data is never counted as a lower level/)
    expect(text('legend.seismicMeaning')).toBeUndefined()
    expect(text('legend.outlineMeaning')).toBeUndefined()
  })

  it('word every level of every risk line in the key: a zone, a named class, or a count of known cavities', () => {
    expect(text('legend.seismicLevel')).toContain('{{value}}')
    for (const level of SEISMIC_LEVELS.filter((zone) => zone < 5)) expect(text(`ind.seismic.classes.${level}`), `zone ${level}`).toMatch(/\S/)
    for (const [id, { levels }] of Object.entries(RISK_LINES)) {
      const def = layerById(id)
      if (def?.scale.kind === 'classes') {
        expect(text(`ind.${id}.classLabel`), id).toContain('{{name}}')
        for (const level of levels) expect(text(`ind.${id}.classes.${level}`), `${id} ${level}`).toMatch(/\S/)
      }
    }
    expect(text('legend.knownCavities')).toContain('{{range}}')
    expect(text('legend.over')).toContain('{{value}}')
  })
})
