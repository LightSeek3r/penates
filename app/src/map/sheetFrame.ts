import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { toLambert93 } from './lambert93'
import { crossings, formatDistance, metresPerPixel, niceDistance } from './sheet'

const MAJOR_STEP = 100_000
const MINOR_STEP = 10_000
const MINOR_FROM_ZOOM = 8
const TICK = 6
const INK = '244, 247, 251'

/**
 * Draws the printed-sheet frame around the map: a neatline plus Lambert-93 ticks whose positions
 * follow the kilometre grid as the map moves. Returns a cleanup function.
 */
export function attachSheetFrame(map: MapLibreMap, stage: HTMLElement): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = 'sheet-frame'
  canvas.setAttribute('aria-hidden', 'true')
  stage.appendChild(canvas)

  let frame = 0
  const draw = () => {
    const ratio = window.devicePixelRatio || 1
    const width = stage.clientWidth
    const height = stage.clientHeight
    const margin = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--sheet-margin')) || 0
    canvas.width = width * ratio
    canvas.height = height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx || margin === 0) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

    const mapWidth = width - margin * 2
    const mapHeight = height - margin * 2
    const labelled = margin >= 24
    const minor = map.getZoom() >= MINOR_FROM_ZOOM

    ctx.strokeStyle = `rgba(${INK}, 0.7)`
    ctx.lineWidth = 1
    ctx.strokeRect(margin - 0.5, margin - 0.5, mapWidth + 1, mapHeight + 1)

    ctx.font = '10px "Noto Sans Variable", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const lambertAt = (x: number, y: number) => {
      const { lng, lat } = map.unproject([x, y])
      return toLambert93(lng, lat)
    }
    const easting = (x: number, y: number) => lambertAt(x, y).easting
    const northing = (x: number, y: number) => lambertAt(x, y).northing

    const ticks = (valueAt: (p: number) => number, length: number) => {
      const major = crossings(valueAt, length, MAJOR_STEP)
      const minors = minor ? crossings(valueAt, length, MINOR_STEP).filter((c) => c.value % MAJOR_STEP !== 0) : []
      return [...major.map((c) => ({ ...c, major: true })), ...minors.map((c) => ({ ...c, major: false }))]
    }
    const stroke = (x1: number, y1: number, x2: number, y2: number, major: boolean) => {
      ctx.strokeStyle = `rgba(${INK}, ${major ? 0.85 : 0.5})`
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    const label = (text: string, x: number, y: number, rotation: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.fillStyle = `rgba(${INK}, 0.85)`
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }
    const km = (value: number) => new Intl.NumberFormat('fr-FR').format(value / 1000)

    for (const { position, value, major } of ticks((x) => easting(x, 0), mapWidth)) {
      stroke(margin + position, margin - TICK, margin + position, margin, major)
      if (major && labelled) label(km(value), margin + position, margin - TICK - 7, 0)
    }
    for (const { position, value, major } of ticks((x) => easting(x, mapHeight), mapWidth)) {
      stroke(margin + position, margin + mapHeight, margin + position, margin + mapHeight + TICK, major)
      if (major && labelled) label(km(value), margin + position, margin + mapHeight + TICK + 7, 0)
    }
    for (const { position, value, major } of ticks((y) => northing(0, y), mapHeight)) {
      stroke(margin - TICK, margin + position, margin, margin + position, major)
      if (major && labelled) label(km(value), margin - TICK - 7, margin + position, -Math.PI / 2)
    }
    for (const { position, value, major } of ticks((y) => northing(mapWidth, y), mapHeight)) {
      stroke(margin + mapWidth, margin + position, margin + mapWidth + TICK, margin + position, major)
      if (major && labelled) label(km(value), margin + mapWidth + TICK + 7, margin + position, Math.PI / 2)
    }
  }

  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(draw)
  }
  map.on('move', schedule)
  map.on('resize', schedule)
  map.on('load', schedule)
  schedule()

  return () => {
    cancelAnimationFrame(frame)
    map.off('move', schedule)
    map.off('resize', schedule)
    map.off('load', schedule)
    canvas.remove()
  }
}

const SEGMENTS = 4
const TARGET_PIXELS = 120

/** Scale bar in the printed-map manner: alternating light and dark segments with 0 / half / full labels. */
export class SheetScale implements IControl {
  private map: MapLibreMap | undefined
  private readonly element = document.createElement('div')
  private readonly bar = document.createElement('div')
  private readonly labels = document.createElement('div')

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map
    this.element.className = 'maplibregl-ctrl sheet-scale'
    this.bar.className = 'sheet-scale__bar'
    for (let index = 0; index < SEGMENTS; index += 1) {
      const segment = document.createElement('span')
      segment.dataset.tone = index % 2 === 0 ? 'light' : 'dark'
      this.bar.appendChild(segment)
    }
    this.labels.className = 'sheet-scale__labels'
    this.element.append(this.bar, this.labels)
    map.on('move', this.update)
    this.update()
    return this.element
  }

  onRemove(): void {
    this.map?.off('move', this.update)
    this.element.remove()
  }

  private readonly update = () => {
    if (!this.map) return
    const perPixel = metresPerPixel(this.map.getCenter().lat, this.map.getZoom())
    const total = niceDistance(perPixel * TARGET_PIXELS)
    this.bar.style.width = `${total / perPixel}px`
    // Unit only on the last label, so the three labels stay short enough for a 120 px bar.
    const half = formatDistance(total / 2).replace(/ (km|m)$/, '')
    this.labels.replaceChildren(...['0', half, formatDistance(total)].map((text) => Object.assign(document.createElement('span'), { textContent: text })))
  }
}
