import type { Map as MapLibreMap } from 'maplibre-gl'

const SIZE = 16
const SCALE = 2

type Painter = (ctx: CanvasRenderingContext2D) => void

const PATTERNS: Record<string, Painter> = {
  // Fewer than 10 sales: diagonal hatch over the price colour.
  'hatch-low': (ctx) => {
    ctx.strokeStyle = 'rgba(11, 27, 58, 0.8)'
    ctx.lineWidth = 1.6
    for (const offset of [-SIZE, 0, SIZE]) {
      ctx.beginPath()
      ctx.moveTo(offset, SIZE)
      ctx.lineTo(offset + SIZE, 0)
      ctx.stroke()
    }
  },
  // No sale kept in the window: sparse dots on the neutral ground.
  dots: (ctx) => {
    ctx.fillStyle = 'rgba(180, 194, 220, 0.45)'
    for (const [x, y] of [[4, 4], [12, 12]]) {
      ctx.beginPath()
      ctx.arc(x, y, 1.1, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  // Outside the DVF database: amber cross-hatch, never mistaken for "cheap".
  'hatch-cross': (ctx) => {
    ctx.strokeStyle = 'rgba(242, 168, 29, 0.5)'
    ctx.lineWidth = 1.2
    for (const offset of [-SIZE, 0, SIZE]) {
      ctx.beginPath()
      ctx.moveTo(offset, SIZE)
      ctx.lineTo(offset + SIZE, 0)
      ctx.moveTo(offset, 0)
      ctx.lineTo(offset + SIZE, SIZE)
      ctx.stroke()
    }
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
