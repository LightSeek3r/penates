import type { Map as MapLibreMap } from 'maplibre-gl'

import { MARK_DIAMETERS, TIERS, markIcon } from '../domain/combine'
import { HATCH_INK_DARK, HATCH_INK_LIGHT } from '../domain/priceLadder'

const SIZE = 16
const SCALE = 2

type Painter = (ctx: CanvasRenderingContext2D) => void

interface Image {
  /** Square side in CSS pixels. */
  size: number
  paint: Painter
}

function diagonal(ctx: CanvasRenderingContext2D, ink: string, width: number) {
  ctx.strokeStyle = ink
  ctx.lineWidth = width
  for (const offset of [-SIZE, 0, SIZE]) {
    ctx.beginPath()
    ctx.moveTo(offset, SIZE)
    ctx.lineTo(offset + SIZE, 0)
    ctx.stroke()
  }
}

const PATTERNS: Record<string, Painter> = {
  // Fewer than 10 sales: opaque diagonal hatch; the ink flips with the price class to stay >= 3:1.
  'hatch-low-light': (ctx) => diagonal(ctx, HATCH_INK_LIGHT, 1.6),
  'hatch-low-dark': (ctx) => diagonal(ctx, HATCH_INK_DARK, 1.6),
  // No sale kept in the window: dense porcelain dots, a texture no price class has.
  dots: (ctx) => {
    ctx.fillStyle = 'rgba(244, 247, 251, 0.8)'
    for (const [x, y] of [[4, 4], [12, 12]]) {
      ctx.beginPath()
      ctx.arc(x, y, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  // Outside the DVF database: neutral cross-hatch (amber is reserved for selection and risk).
  'hatch-cross': (ctx) => {
    diagonal(ctx, 'rgba(244, 247, 251, 0.3)', 1.2)
    ctx.save()
    ctx.translate(SIZE, 0)
    ctx.scale(-1, 1)
    diagonal(ctx, 'rgba(244, 247, 251, 0.3)', 1.2)
    ctx.restore()
  },
}

const MARK_OUTLINE = 1.5

/**
 * Second-indicator disc: porcelain core inside a midnight outline, so one of the two inks always stands out from the
 * fill below. A rough estimate is an open ring of the same two inks (porcelain edged with midnight), hollow in the
 * middle so it never reads as a filled disc.
 */
function mark(diameter: number, open: boolean): Image {
  const size = diameter + 2 * MARK_OUTLINE
  return {
    size,
    paint: (ctx) => {
      const centre = size / 2
      const ring = (radius: number, ink: string, width: number) => {
        ctx.beginPath()
        ctx.arc(centre, centre, radius, 0, Math.PI * 2)
        ctx.strokeStyle = ink
        ctx.lineWidth = width
        ctx.stroke()
      }
      if (open) {
        ring(diameter / 2 - 1, HATCH_INK_DARK, 3.6)
        ring(diameter / 2 - 1, HATCH_INK_LIGHT, 1.6)
        return
      }
      ctx.beginPath()
      ctx.arc(centre, centre, diameter / 2, 0, Math.PI * 2)
      ctx.fillStyle = HATCH_INK_LIGHT
      ctx.fill()
      ring(diameter / 2, HATCH_INK_DARK, MARK_OUTLINE)
    },
  }
}

const IMAGES: Record<string, Image> = {
  ...Object.fromEntries(Object.entries(PATTERNS).map(([id, paint]) => [id, { size: SIZE, paint }])),
  ...Object.fromEntries(TIERS.flatMap((tier) => [false, true].map((open) => [markIcon(tier, open), mark(MARK_DIAMETERS[tier], open)]))),
}

function render({ size, paint }: Image): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(size * SCALE)
  canvas.height = Math.ceil(size * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.scale(SCALE, SCALE)
  paint(ctx)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function registerPatterns(map: MapLibreMap): void {
  map.setMissingStyleImageResolver((id) => {
    const image = IMAGES[id]
    if (image && !map.hasImage(id)) map.addImage(id, render(image), { pixelRatio: SCALE })
  })
}
