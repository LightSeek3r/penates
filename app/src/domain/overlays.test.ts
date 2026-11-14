import { describe, expect, it } from 'vitest'
// The pipeline's copy of the place catalogue; the test below keeps the two in step.
import kinds from '../../../pipeline/settling/overlays/kinds.json'
import { type Dichromacy, DICHROMACY, contrast, oklabDistance } from './colour'
import { CROSS_COLORS } from './combine'
import { LAYERS, type LayerDef, NO_DATA_COLOR, layerById } from './layers'
import {
  OVERLAYS,
  OVERLAY_GROUPS,
  PLACE_FAMILIES,
  PLACE_KINDS,
  type OverlaySources,
  RISK_LINES,
  RISK_OVERLAYS,
  RISK_STYLE,
  SEISMIC_LEVELS,
  formatOverlays,
  isOverlayAvailable,
  isOverlayId,
  isPlaceKind,
  isPlaceOverlay,
  overlayById,
  parseOverlays,
  placeKindsOf,
  readPlaceFeature,
  riskLevels,
  withOverlay,
} from './overlays'
import { HATCH_INK_DARK, PRICE_COLORS } from './priceLadder'

const AMBER = '#F2A81D'
const SCARLET = '#E03A2F'
const VISIONS: readonly (Dichromacy | undefined)[] = [undefined, ...(Object.keys(DICHROMACY) as Dichromacy[])]

describe('overlay catalogue', () => {
  it('lists the risks first, in the documented order, then every place kind in catalogue order', () => {
    expect(OVERLAYS.map((def) => def.id)).toEqual(['seismic', 'flood', 'clay', 'radon', 'cavities', ...PLACE_KINDS.map((kind) => kind.id)])
    expect(OVERLAYS.filter((def) => def.kind === 'risk').map((def) => def.id)).toEqual([...RISK_OVERLAYS])
  })

  it('uses each id once, in a form that survives the URL', () => {
    const ids = OVERLAYS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+$/)
  })

  it('puts risks in the risk group and each place in its family, groups in display order', () => {
    expect(OVERLAY_GROUPS).toEqual(['risk', 'health', 'education', 'daily', 'leisure'])
    expect(OVERLAY_GROUPS).toEqual(['risk', ...PLACE_FAMILIES])
    for (const def of OVERLAYS) {
      const place = PLACE_KINDS.find((kind) => kind.id === def.id)
      expect(def.kind, def.id).toBe(place ? 'place' : 'risk')
      expect(def.group, def.id).toBe(place ? place.family : 'risk')
    }
    const firstIndex = OVERLAY_GROUPS.map((group) => OVERLAYS.findIndex((def) => def.group === group))
    expect(firstIndex).toEqual([...firstIndex].sort((a, b) => a - b))
  })

  it('finds an overlay by id and recognises ids', () => {
    expect(overlayById('hos')).toEqual({ id: 'hos', group: 'health', kind: 'place' })
    expect(overlayById('flood').kind).toBe('risk')
    expect(overlayById('nope')).toBeUndefined()
    expect(isOverlayId('cavities')).toBe(true)
    expect(isOverlayId('hospital')).toBe(false)
    expect(isOverlayId(null)).toBe(false)
    expect(isPlaceKind('gp')).toBe(true)
    expect(isPlaceKind('seismic')).toBe(false)
    expect(isPlaceOverlay('lib')).toBe(true)
    expect(isPlaceOverlay('radon')).toBe(false)
  })

  it('stays equal to the pipeline catalogue in both directions: ids, families and first zoom', () => {
    const pipeline = new Map(kinds.places.map((kind) => [kind.id, { family: kind.family, minZoom: kind.minzoom }]))
    const app = new Map<string, { family: string; minZoom: number }>(PLACE_KINDS.map((kind) => [kind.id, { family: kind.family, minZoom: kind.minZoom }]))
    expect(pipeline.size).toBe(kinds.places.length)
    for (const [id, expected] of pipeline) expect(app.get(id), `${id} in the app`).toEqual(expected)
    for (const [id, expected] of app) expect(pipeline.get(id), `${id} in the pipeline`).toEqual(expected)
  })
})

describe('overlay lists in links', () => {
  it('read a comma list in catalogue order, dropping unknown ids, repeats and blanks', () => {
    expect(parseOverlays('gp,hos,nope,gp,,seismic, cavities ')).toEqual(['seismic', 'cavities', 'hos', 'gp'])
    expect(parseOverlays('')).toEqual([])
    expect(parseOverlays(null)).toEqual([])
    expect(parseOverlays('HOS')).toEqual([])
  })

  it('write the same order, and nothing when there is none', () => {
    expect(formatOverlays(['gp', 'seismic', 'hos'])).toBe('seismic,hos,gp')
    expect(formatOverlays([])).toBe('')
    expect(formatOverlays(['hos', 'hos'])).toBe('hos')
  })

  it('round-trip every overlay alone and all of them together', () => {
    for (const { id } of OVERLAYS) expect(parseOverlays(formatOverlays([id])), id).toEqual([id])
    const all = OVERLAYS.map((def) => def.id)
    expect(parseOverlays(formatOverlays(all))).toEqual(all)
  })

  it('switch one overlay on or off without disturbing the others or the order', () => {
    expect(withOverlay(['seismic', 'gp'], 'hos', true)).toEqual(['seismic', 'hos', 'gp'])
    expect(withOverlay(['seismic', 'hos'], 'hos', true)).toEqual(['seismic', 'hos'])
    expect(withOverlay(['seismic', 'hos'], 'seismic', false)).toEqual(['hos'])
    expect(withOverlay([], 'cin', false)).toEqual([])
    expect(placeKindsOf(['gp', 'seismic', 'hos', 'flood'])).toEqual(['hos', 'gp'])
    expect(placeKindsOf(['seismic'])).toEqual([])
  })
})

describe('overlay availability', () => {
  const sources: OverlaySources = { places: new Set(['hos', 'gp']), seismic: true, risks: new Set(['flood', 'radon']) }

  it('offers a place kind, the seismic lines or a risk only when the overlays archive holds them', () => {
    expect(isOverlayAvailable('hos', sources)).toBe(true)
    expect(isOverlayAvailable('pha', sources)).toBe(false)
    expect(isOverlayAvailable('seismic', sources)).toBe(true)
    expect(isOverlayAvailable('seismic', { ...sources, seismic: false })).toBe(false)
    expect(OVERLAYS.filter((def) => isOverlayAvailable(def.id, sources)).map((def) => def.id)).toEqual(['seismic', 'flood', 'radon', 'hos', 'gp'])
  })

  it('judges each risk on its own lines, not on the others or on the places', () => {
    const only = (id: string): OverlaySources => ({ places: new Set(), seismic: false, risks: new Set([id]) })
    for (const id of ['flood', 'clay', 'radon', 'cavities'] as const) {
      expect(isOverlayAvailable(id, only(id)), id).toBe(true)
      expect(isOverlayAvailable(id, only('x')), id).toBe(false)
      expect(isOverlayAvailable(id, { ...sources, risks: new Set() }), id).toBe(false)
    }
    expect(isOverlayAvailable('seismic', only('seismic'))).toBe(false)
  })

  it('offers nothing without the overlays manifest, so a missing archive or a missing risk layer hides the overlay', () => {
    for (const { id } of OVERLAYS) expect(isOverlayAvailable(id, null), id).toBe(false)
  })
})

describe('risk lines', () => {
  it('are drawn at these levels, the line marking where the class rises to at least the level', () => {
    expect(Object.fromEntries(Object.entries(RISK_LINES).map(([id, risk]) => [id, [risk.property, [...risk.levels]]]))).toEqual({
      flood: ['fl', [1, 2, 3]],
      clay: ['cl', [1, 2, 3]],
      radon: ['rn', [2, 3]],
      cavities: ['cv', [1, 5, 25]],
    })
    expect(riskLevels('seismic')).toEqual([...SEISMIC_LEVELS])
    expect(Object.keys(RISK_LINES)).toEqual(RISK_OVERLAYS.filter((id) => id !== 'seismic'))
  })

  it('read the property of the catalogue layer they replaced, with levels that are values of its scale', () => {
    for (const [id, risk] of Object.entries(RISK_LINES)) {
      const layer: LayerDef | undefined = LAYERS.find((entry: LayerDef) => entry.overlay === id)
      expect(layer?.property, id).toBe(risk.property)
      expect([...risk.levels], id).toEqual([...risk.levels].sort((a, b) => a - b))
      expect(new Set(risk.levels).size, id).toBe(risk.levels.length)
      if (layer?.scale.kind === 'classes') for (const level of risk.levels) expect(layer.scale.values, `${id} ${level}`).toContain(level)
      if (layer?.scale.kind === 'steps') for (const level of risk.levels) expect(layer.scale.breaks, `${id} ${level}`).toContain(level)
    }
  })

  it('stay the retired layers\' overlays: one layer per overlay, ids that exist', () => {
    const overlaid: readonly LayerDef[] = LAYERS.filter((layer: LayerDef) => layer.overlay !== undefined)
    expect(overlaid.map((layer) => layer.overlay)).toEqual(['seismic', 'flood', 'clay', 'radon', 'cavities', 'hos', 'gp', 'pha', 'den', 'cre', 'pri', 'col', 'lyc', 'sup', 'bak', 'pos', 'pool', 'sta'])
    for (const layer of overlaid) expect(isOverlayId(layer.overlay ?? null), layer.id).toBe(true)
    expect(layerById('gp')?.overlay).toBe('gp')
  })
})

describe('risk line styles', () => {
  const risks = RISK_OVERLAYS.map((id) => ({ id, ...RISK_STYLE[id] }))
  const MIDNIGHT = HATCH_INK_DARK

  it('give a width to every level of the line, seismic zone or risk class, heavier as the level grows', () => {
    for (const id of RISK_OVERLAYS) expect(RISK_STYLE[id].widths, id).toHaveLength(riskLevels(id).length)
    expect(RISK_STYLE.seismic.widths).toHaveLength(SEISMIC_LEVELS.length)
    for (const { id, widths } of risks) {
      expect([...widths], id).toEqual([...widths].sort((a, b) => a - b))
      expect(new Set(widths).size, id).toBe(widths.length)
      for (const width of widths) expect(width, id).toBeGreaterThan(0.5)
    }
  })

  it('keep every ink apart from the others under normal vision and the three dichromacies', () => {
    for (const vision of VISIONS) {
      for (const a of risks) {
        for (const b of risks) {
          if (a.id < b.id) expect(oklabDistance(a.ink, b.ink, vision), `${a.id} / ${b.id} (${vision ?? 'normal vision'})`).toBeGreaterThanOrEqual(0.08)
        }
      }
    }
  })

  it('keep clear of selection amber, error scarlet and the price ladder', () => {
    for (const { id, ink } of risks) {
      expect(oklabDistance(ink, AMBER), `${id} amber`).toBeGreaterThanOrEqual(0.1)
      expect(oklabDistance(ink, SCARLET), `${id} scarlet`).toBeGreaterThanOrEqual(0.1)
      for (const price of PRICE_COLORS) expect(oklabDistance(ink, price), `${id} ${price}`).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('stay readable on every fill a commune can take: the ink or its midnight casing keeps 3:1', () => {
    const fills = [...PRICE_COLORS, NO_DATA_COLOR, ...CROSS_COLORS.flat()]
    for (const { id, ink } of risks) {
      for (const fill of fills) expect(Math.max(contrast(ink, fill), contrast(MIDNIGHT, fill)), `${id} on ${fill}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('stay readable against their own casing', () => {
    for (const { id, ink } of risks) expect(contrast(ink, MIDNIGHT), id).toBeGreaterThanOrEqual(7)
  })

  it('differ in dash pattern too, so colour is never the only cue: only the seismic isolines are solid', () => {
    expect(RISK_STYLE.seismic.dash).toBeUndefined()
    const dashes = risks.flatMap(({ id, dash }) => (dash ? [{ id, text: dash.join(',') }] : []))
    expect(dashes.map((entry) => entry.id)).toEqual(['flood', 'clay', 'radon', 'cavities'])
    expect(new Set(dashes.map((entry) => entry.text)).size).toBe(dashes.length)
    for (const { id, dash } of risks) for (const length of dash ?? []) expect(length, id).toBeGreaterThan(0)
  })

  it('use well-formed hex inks', () => {
    for (const { id, ink } of risks) expect(ink, id).toMatch(/^#[0-9A-F]{6}$/)
  })
})

describe('places read from a tile feature', () => {
  it('carry the kind, a name only when there is one, the count and whether the position is approximate', () => {
    expect(readPlaceFeature({ k: 'hos', n: 'Hopital Nord', c: 3, a: 1 }, 5.4, 43.3)).toEqual({ kind: 'hos', name: 'Hopital Nord', count: 3, approximate: true, lng: 5.4, lat: 43.3 })
    expect(readPlaceFeature({ k: 'gp' }, 2.35, 48.85)).toEqual({ kind: 'gp', name: null, count: 1, approximate: false, lng: 2.35, lat: 48.85 })
  })

  it('refuse a kind this app does not know, and read odd values as the plain case', () => {
    expect(readPlaceFeature({ k: 'zzz' }, 0, 0)).toBeNull()
    expect(readPlaceFeature({ k: 'seismic' }, 0, 0)).toBeNull()
    expect(readPlaceFeature({}, 0, 0)).toBeNull()
    expect(readPlaceFeature(null, 0, 0)).toBeNull()
    expect(readPlaceFeature({ k: 'pri', n: '', c: 0, a: 0 }, 1, 2)).toMatchObject({ name: null, count: 1, approximate: false })
    expect(readPlaceFeature({ k: 'pri', n: 12, c: '4', a: true }, 1, 2)).toMatchObject({ name: null, count: 1, approximate: false })
  })
})
