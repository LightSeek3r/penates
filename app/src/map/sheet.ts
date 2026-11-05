// Pure helpers for the printed-sheet furniture: tick positions on the frame and the scale bar length.

/**
 * Where the values returned by `valueAt` cross a multiple of `step` along 0..length.
 * `valueAt` is sampled every `sample` px and crossings are linearly interpolated.
 */
export function crossings(valueAt: (position: number) => number, length: number, step: number, sample = 4): { position: number; value: number }[] {
  const found: { position: number; value: number }[] = []
  let previousPosition = 0
  let previousValue = valueAt(0)
  for (let position = sample; position < length + sample; position += sample) {
    const clamped = Math.min(position, length)
    const value = valueAt(clamped)
    const from = Math.floor(Math.min(previousValue, value) / step)
    const to = Math.floor(Math.max(previousValue, value) / step)
    for (let index = from + 1; index <= to; index += 1) {
      const target = index * step
      const fraction = (target - previousValue) / (value - previousValue)
      found.push({ position: previousPosition + fraction * (clamped - previousPosition), value: target })
    }
    previousPosition = clamped
    previousValue = value
    if (clamped === length) break
  }
  return found
}

const NICE = [1, 2, 5]

/** The largest 1-2-5 distance in metres that fits `maxMetres`. */
export function niceDistance(maxMetres: number): number {
  const power = 10 ** Math.floor(Math.log10(maxMetres))
  return NICE.map((factor) => factor * power).filter((candidate) => candidate <= maxMetres).at(-1) ?? power
}

export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
}

/** Metres per CSS pixel at a latitude for MapLibre's 512 px tiles. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}
