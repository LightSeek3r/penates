import { describe, expect, it } from 'vitest'
import { DICHROMACY, oklabDistance, type Dichromacy } from './colour'
import { PLACE_FAMILIES, PLACE_KINDS } from './overlays'
import { PLACE_GLYPH_BOX, PLACE_GLYPH_PATHS, PLACE_GLYPH_REACH, PLACE_INKS, PLACE_KINDS_BY_FAMILY } from './placeGlyphs'
import { NO_PRICE_COLOR, PRICE_COLORS } from './priceLadder'

type Point = readonly [number, number]

const ARGUMENTS = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 } as const
type Command = keyof typeof ARGUMENTS
const NUMBER = /-?\d*\.?\d+/g
const closed = new WeakSet<Point[]>()

/**
 * Contours of a path, curves flattened. Accepts only what the pictograms use (absolute M, L, H, V, C, Q, Z, each
 * with exactly its own numbers) and throws on anything else, which is what "parses as path data" means here.
 */
function contours(d: string): Point[][] {
  if (!/^[MLHVCQZ\d\s.,-]+$/.test(d)) throw new Error(`not path data: ${d}`)
  const shapes: Point[][] = []
  let current: Point[] | null = null
  let at: Point = [0, 0]
  for (const [, command, rest] of d.matchAll(/([MLHVCQZ])([^MLHVCQZ]*)/g)) {
    const numbers = (rest.match(NUMBER) ?? []).map(Number)
    if (rest.replace(NUMBER, '').trim().replace(/[\s,]/g, '') !== '') throw new Error(`stray characters after ${command}`)
    if (numbers.length !== ARGUMENTS[command as Command]) throw new Error(`${command} takes ${ARGUMENTS[command as Command]} numbers, got ${numbers.length}`)
    if (command === 'M') {
      if (current && !closed.has(current)) throw new Error('contour left open')
      current = []
      shapes.push(current)
      at = [numbers[0], numbers[1]]
      current.push(at)
      continue
    }
    if (!current) throw new Error('path must start with M')
    if (command === 'Z') {
      closed.add(current)
      continue
    }
    if (closed.has(current)) throw new Error('segment after Z')
    if (command === 'L') at = [numbers[0], numbers[1]]
    else if (command === 'H') at = [numbers[0], at[1]]
    else if (command === 'V') at = [at[0], numbers[0]]
    else {
      const control = command === 'C' ? [[numbers[0], numbers[1]], [numbers[2], numbers[3]]] : [[numbers[0], numbers[1]]]
      const end: Point = [numbers[numbers.length - 2], numbers[numbers.length - 1]]
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12
        const u = 1 - t
        const [x0, y0] = at
        current.push(
          command === 'C'
            ? [u ** 3 * x0 + 3 * u * u * t * control[0][0] + 3 * u * t * t * control[1][0] + t ** 3 * end[0], u ** 3 * y0 + 3 * u * u * t * control[0][1] + 3 * u * t * t * control[1][1] + t ** 3 * end[1]]
            : [u * u * x0 + 2 * u * t * control[0][0] + t * t * end[0], u * u * y0 + 2 * u * t * control[0][1] + t * t * end[1]],
        )
      }
      at = end
      continue
    }
    current.push(at)
  }
  if (current && !closed.has(current)) throw new Error('contour left open')
  return shapes
}
/** Nonzero winding number of a point, as the canvas and SVG fill rule counts it. */
function winding([x, y]: Point, shapes: Point[][]): number {
  let turns = 0
  for (const points of shapes) {
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % points.length]
      if (y1 <= y ? y2 > y : y2 <= y) {
        if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) > x) turns += y2 > y1 ? 1 : -1
      }
    }
  }
  return turns
}

const CELLS = 48
const CELL = PLACE_GLYPH_BOX / CELLS

/** The pictogram as a grid of filled cells, row by row. */
function raster(d: string): boolean[] {
  const shapes = contours(d)
  return Array.from({ length: CELLS * CELLS }, (_, index) => winding([((index % CELLS) + 0.5) * CELL, (Math.floor(index / CELLS) + 0.5) * CELL], shapes) !== 0)
}

const ids = PLACE_KINDS.map((kind) => kind.id)
const filled = (cells: boolean[]) => cells.filter(Boolean).length

describe('place pictograms', () => {
  it('has one path per kind and no other', () => {
    expect(Object.keys(PLACE_GLYPH_PATHS).sort()).toEqual([...ids].sort())
    for (const id of ids) expect(PLACE_GLYPH_PATHS[id].length, id).toBeGreaterThan(20)
  })

  it('rejects what is not simple path data', () => {
    expect(() => contours('M0 0L1 1')).toThrow('left open')
    expect(() => contours('M0 0L1 1Zabc')).toThrow('not path data')
    expect(() => contours('M0 0L1Z')).toThrow('takes 2 numbers')
    expect(() => contours('m0 0l1 1z')).toThrow('not path data')
  })

  it.each(ids)('%s parses and stays inside the 24 x 24 box', (id) => {
    const shapes = contours(PLACE_GLYPH_PATHS[id])
    expect(shapes.length).toBeGreaterThan(0)
    for (const [x, y] of shapes.flat()) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(PLACE_GLYPH_BOX)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(PLACE_GLYPH_BOX)
    }
  })

  it.each(ids)('%s fills a solid share of the box and fits the reach circle', (id) => {
    const cells = raster(PLACE_GLYPH_PATHS[id])
    const share = filled(cells) / cells.length
    expect(share, 'share of the box').toBeGreaterThanOrEqual(0.18)
    expect(share, 'share of the box').toBeLessThanOrEqual(0.62)
    const half = PLACE_GLYPH_BOX / 2
    cells.forEach((on, index) => {
      if (on) expect(Math.hypot(((index % CELLS) + 0.5) * CELL - half, (Math.floor(index / CELLS) + 0.5) * CELL - half), `cell ${index}`).toBeLessThanOrEqual(PLACE_GLYPH_REACH)
    })
  })

  // Shape, not colour, tells kinds apart: any two pictograms must differ over a good part of what either covers.
  it('keeps the 17 silhouettes visibly different', () => {
    const rasters = ids.map((id) => raster(PLACE_GLYPH_PATHS[id]))
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const either = rasters[i].filter((on, cell) => on || rasters[j][cell]).length
        const differing = rasters[i].filter((on, cell) => on !== rasters[j][cell]).length
        expect(differing / either, `${ids[i]} / ${ids[j]}`).toBeGreaterThanOrEqual(0.3)
      }
    }
  })

  it('lists each kind once under its family', () => {
    expect(PLACE_FAMILIES.flatMap((family) => PLACE_KINDS_BY_FAMILY[family]).sort()).toEqual([...ids].sort())
    for (const family of PLACE_FAMILIES) for (const id of PLACE_KINDS_BY_FAMILY[family]) expect(PLACE_KINDS.find((kind) => kind.id === id)?.family).toBe(family)
  })
})

describe('place inks', () => {
  const AMBER = '#F2A81D'
  const SCARLET = '#E03A2F'
  const families = PLACE_FAMILIES.map((family) => [family, PLACE_INKS[family]] as const)
  const visions: readonly [string, Dichromacy | undefined][] = [['normal vision', undefined], ...(Object.keys(DICHROMACY) as Dichromacy[]).map((name): [string, Dichromacy] => [name, name])]

  it('gives each family one #RRGGBB ink', () => {
    expect(Object.keys(PLACE_INKS).sort()).toEqual([...PLACE_FAMILIES].sort())
    for (const [, ink] of families) expect(ink).toMatch(/^#[0-9A-F]{6}$/)
  })

  // 0.08 in OKLab is several times the just-noticeable difference (about 0.02), so the families stay apart as dots.
  it.each(visions)('keeps the four inks at least 0.08 apart in OKLab with %s', (_name, vision) => {
    for (const [i, [a, inkA]] of families.entries()) {
      for (const [b, inkB] of families.slice(i + 1)) expect(oklabDistance(inkA, inkB, vision), `${a} / ${b}`).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('borrows neither selection amber, error scarlet nor any colour of the price ladder', () => {
    for (const [family, ink] of families) {
      for (const taken of [AMBER, SCARLET, NO_PRICE_COLOR, ...PRICE_COLORS]) expect(oklabDistance(ink, taken), `${family} / ${taken}`).toBeGreaterThanOrEqual(0.1)
    }
  })
})
