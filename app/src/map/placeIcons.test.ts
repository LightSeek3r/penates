import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrast } from '../domain/colour'
import { CROSS_COLORS } from '../domain/combine'
import { LADDERS, NO_DATA_COLOR } from '../domain/layers'
import { PLACE_KINDS } from '../domain/overlays'
import { PLACE_GLYPH_BOX, PLACE_GLYPH_PATHS, PLACE_GLYPH_REACH, PLACE_INKS } from '../domain/placeGlyphs'
import { HATCH_INK_DARK, HATCH_INK_LIGHT } from '../domain/priceLadder'
import { placeDotImage, placeGlyphImage, placeIconSpec, registerPlaceIcons } from './placeIcons'

const ids = PLACE_KINDS.map((kind) => kind.id)

describe('place icon images', () => {
  it('names two distinct images per kind', () => {
    expect(placeDotImage('hos')).toBe('place-dot-hos')
    expect(placeGlyphImage('hos')).toBe('place-glyph-hos')
    const names = ids.flatMap((id) => [placeDotImage(id), placeGlyphImage(id)])
    expect(new Set(names).size).toBe(ids.length * 2)
    for (const id of ids) {
      expect(placeIconSpec(id, 'dot').image).toBe(placeDotImage(id))
      expect(placeIconSpec(id, 'glyph').image).toBe(placeGlyphImage(id))
    }
  })

  it('draws a dot of about 12 px and a badge of about 24 px, casing outside ring outside the family ink', () => {
    for (const { id, family } of PLACE_KINDS) {
      const dot = placeIconSpec(id, 'dot')
      const badge = placeIconSpec(id, 'glyph')
      expect(dot.size).toBe(12)
      expect(badge.size).toBeGreaterThanOrEqual(24)
      expect(badge.size).toBeLessThanOrEqual(28)
      for (const spec of [dot, badge]) {
        const [casing, ring, core] = spec.discs
        expect(casing.radius).toBeLessThanOrEqual(spec.size / 2)
        expect(ring.radius).toBeLessThan(casing.radius)
        expect(core.radius).toBeLessThan(ring.radius)
        expect([casing.ink, ring.ink, core.ink]).toEqual([HATCH_INK_DARK, HATCH_INK_LIGHT, PLACE_INKS[family]])
      }
    }
  })

  it('puts the pictogram in midnight on badges only, inside the core', () => {
    for (const id of ids) {
      expect(placeIconSpec(id, 'dot').glyph).toBeNull()
      const { glyph, discs, size } = placeIconSpec(id, 'glyph')
      if (!glyph) throw new Error(`${id} has no pictogram`)
      expect(glyph.path).toBe(PLACE_GLYPH_PATHS[id])
      expect(glyph.ink).toBe(HATCH_INK_DARK)
      expect(glyph.x * 2 + glyph.scale * PLACE_GLYPH_BOX).toBeCloseTo(size)
      expect(glyph.y).toBe(glyph.x)
      expect(PLACE_GLYPH_REACH * glyph.scale, id).toBeLessThanOrEqual(discs[2].radius)
    }
  })
})

describe('place icon colours', () => {
  const fills = [...Object.values(LADDERS).flat(), ...CROSS_COLORS.flat(), NO_DATA_COLOR]

  // Same two inks as the second-indicator discs: whichever fill is below, one of the two edges stands out.
  it('keeps the porcelain ring or the midnight casing at 3:1 on every colour a commune can take', () => {
    for (const id of ids) {
      for (const shape of ['dot', 'glyph'] as const) {
        const [casing, ring] = placeIconSpec(id, shape).discs
        for (const fill of fills) expect(Math.max(contrast(fill, ring.ink), contrast(fill, casing.ink)), `${id} ${shape} on ${fill}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('reads the midnight pictogram at 4.5:1 on every family ink', () => {
    for (const id of ids) {
      const { glyph, discs } = placeIconSpec(id, 'glyph')
      if (!glyph) throw new Error(`${id} has no pictogram`)
      expect(contrast(discs[2].ink, glyph.ink), id).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('registerPlaceIcons', () => {
  afterEach(() => vi.unstubAllGlobals())

  function fakeCanvas() {
    const context = { scale: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), translate: vi.fn(), getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({ width, height })) }
    const canvas = { width: 0, height: 0, getContext: () => context }
    vi.stubGlobal('document', { createElement: () => canvas })
    vi.stubGlobal('Path2D', class {})
    return context
  }

  it('adds a dot and a badge of every kind at twice their CSS size, once each', () => {
    const context = fakeCanvas()
    const images = new Map<string, { width: number; height: number }>()
    const options: unknown[] = []
    const map = {
      hasImage: (id: string) => images.has(id),
      addImage: (id: string, image: { width: number; height: number }, option: unknown) => {
        images.set(id, image)
        options.push(option)
      },
    }
    registerPlaceIcons(map as never)
    expect(images.size).toBe(ids.length * 2)
    expect(options.every((option) => JSON.stringify(option) === JSON.stringify({ pixelRatio: 2 }))).toBe(true)
    for (const id of ids) {
      expect(images.get(placeDotImage(id))).toEqual({ width: 24, height: 24 })
      expect(images.get(placeGlyphImage(id))?.width).toBe(placeIconSpec(id, 'glyph').size * 2)
    }
    expect(context.fill).toHaveBeenCalledTimes(ids.length * (3 + 4))

    registerPlaceIcons(map as never)
    expect(options).toHaveLength(ids.length * 2)
  })
})
