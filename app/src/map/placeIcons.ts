import type { Map as MapLibreMap } from 'maplibre-gl'

import { PLACE_KINDS, type PlaceKindId } from '../domain/overlays'
import { PLACE_GLYPH_BOX, PLACE_GLYPH_PATHS, PLACE_INKS } from '../domain/placeGlyphs'
import { HATCH_INK_DARK, HATCH_INK_LIGHT } from '../domain/priceLadder'

/** Images are drawn at twice their CSS size so they stay sharp on dense screens. */
const SCALE = 2

/** A compact dot up to zoom 12, a badge with the kind's pictogram from zoom 12. */
export type PlaceIconShape = 'dot' | 'glyph'

export const placeDotImage = (id: PlaceKindId): string => `place-dot-${id}`
export const placeGlyphImage = (id: PlaceKindId): string => `place-glyph-${id}`

interface Disc {
  /** Outer radius in CSS pixels. */
  radius: number
  ink: string
}

export interface PlaceIconSpec {
  /** Image id on the map. */
  image: string
  /** Square side in CSS pixels. */
  size: number
  /** Concentric discs, largest first: midnight casing, porcelain ring, family-ink core. */
  discs: readonly [casing: Disc, ring: Disc, core: Disc]
  /** The pictogram, drawn in midnight on the core; none on a dot, which is too small to carry one. */
  glyph: { path: string; ink: string; x: number; y: number; scale: number } | null
}

// The casing and the ring are the two inks of the second-indicator discs (combine.ts): one of them keeps 3:1 on any
// fill, so the dot stands out from every theme colour whatever the family ink is.
const DOT = { size: 12, casing: 6, ring: 5, core: 3.5 }
const BADGE = { size: 26, casing: 13, ring: 11.75, core: 10.25, glyph: 18 }

/** What to paint for a kind's dot or badge: pure data, so the geometry and colours can be tested without a canvas. */
export function placeIconSpec(id: PlaceKindId, shape: PlaceIconShape): PlaceIconSpec {
  const family = PLACE_KINDS.find((kind) => kind.id === id)?.family
  if (!family) throw new Error(`Unknown place kind: ${id}`)
  const core = PLACE_INKS[family]
  if (shape === 'dot') {
    return {
      image: placeDotImage(id),
      size: DOT.size,
      discs: [{ radius: DOT.casing, ink: HATCH_INK_DARK }, { radius: DOT.ring, ink: HATCH_INK_LIGHT }, { radius: DOT.core, ink: core }],
      glyph: null,
    }
  }
  const offset = (BADGE.size - BADGE.glyph) / 2
  return {
    image: placeGlyphImage(id),
    size: BADGE.size,
    discs: [{ radius: BADGE.casing, ink: HATCH_INK_DARK }, { radius: BADGE.ring, ink: HATCH_INK_LIGHT }, { radius: BADGE.core, ink: core }],
    glyph: { path: PLACE_GLYPH_PATHS[id], ink: HATCH_INK_DARK, x: offset, y: offset, scale: BADGE.glyph / PLACE_GLYPH_BOX },
  }
}

function render(spec: PlaceIconSpec): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = spec.size * SCALE
  canvas.height = spec.size * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.scale(SCALE, SCALE)
  for (const { radius, ink } of spec.discs) {
    ctx.beginPath()
    ctx.arc(spec.size / 2, spec.size / 2, radius, 0, Math.PI * 2)
    ctx.fillStyle = ink
    ctx.fill()
  }
  if (spec.glyph) {
    ctx.translate(spec.glyph.x, spec.glyph.y)
    ctx.scale(spec.glyph.scale, spec.glyph.scale)
    ctx.fillStyle = spec.glyph.ink
    ctx.fill(new Path2D(spec.glyph.path))
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Adds the dot and the badge of every kind, skipping any already on the map. */
export function registerPlaceIcons(map: MapLibreMap): void {
  for (const { id } of PLACE_KINDS) {
    for (const shape of ['dot', 'glyph'] as const) {
      const spec = placeIconSpec(id, shape)
      if (!map.hasImage(spec.image)) map.addImage(spec.image, render(spec), { pixelRatio: SCALE })
    }
  }
}
