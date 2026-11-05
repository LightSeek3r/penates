import type { Map as MapLibreMap } from 'maplibre-gl'

import { HATCH_INK_DARK, HATCH_INK_LIGHT } from '../domain/priceLadder'

const SIZE = 16
const SCALE = 2

type Painter = (ctx: CanvasRenderingContext2D) => void

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
    diagonal(ctx, 'rgba(244, 247, 251, 0.4)', 1.2)
    ctx.save()
    ctx.translate(SIZE, 0)
    ctx.scale(-1, 1)
    diagonal(ctx, 'rgba(244, 247, 251, 0.4)', 1.2)
    ctx.restore()
  },
}

function render(paint: Painter): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE * SCALE
  canvas.height = SIZE * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.scale(SCALE, SCALE)
  paint(ctx)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export function registerPatterns(map: MapLibreMap): void {
  map.setMissingStyleImageResolver((id) => {
    const paint = PATTERNS[id]
    if (paint && !map.hasImage(id)) map.addImage(id, render(paint), { pixelRatio: SCALE })
  })
}
