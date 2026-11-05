import { describe, expect, it } from 'vitest'
import { fromLambert93, toLambert93 } from './lambert93'
import { crossings, formatDistance, metresPerPixel, niceDistance } from './sheet'

// Reference values computed with pyproj (EPSG:4326 -> EPSG:2154).
const REFERENCE = [
  { name: 'Paris', lng: 2.3522, lat: 48.8566, easting: 652469.0, northing: 6862035.3 },
  { name: 'Lyon', lng: 4.8357, lat: 45.764, easting: 842666.7, northing: 6519924.4 },
  { name: 'Brest', lng: -4.4861, lat: 48.3904, easting: 146633.0, northing: 6836262.3 },
  { name: 'Strasbourg', lng: 7.7521, lat: 48.5734, easting: 1050362.7, northing: 6840899.6 },
  { name: 'Ajaccio', lng: 8.7386, lat: 41.9192, easting: 1176667.6, northing: 6108273.3 },
  { name: 'Lille', lng: 3.0573, lat: 50.6292, easting: 704061.1, northing: 7059136.6 },
]

describe('Lambert-93', () => {
  it.each(REFERENCE)('projects $name to within a metre of pyproj', ({ lng, lat, easting, northing }) => {
    const point = toLambert93(lng, lat)
    expect(Math.abs(point.easting - easting)).toBeLessThan(1)
    expect(Math.abs(point.northing - northing)).toBeLessThan(1)
  })

  it.each(REFERENCE)('round-trips $name', ({ lng, lat }) => {
    const { easting, northing } = toLambert93(lng, lat)
    const back = fromLambert93(easting, northing)
    expect(back.lng).toBeCloseTo(lng, 7)
    expect(back.lat).toBeCloseTo(lat, 7)
  })
})

describe('crossings', () => {
  it('finds each multiple of the step with interpolated positions', () => {
    const found = crossings((x) => 1000 + x * 10, 100, 250)
    expect(found.map((c) => c.value)).toEqual([1250, 1500, 1750, 2000])
    expect(found.map((c) => Math.round(c.position))).toEqual([25, 50, 75, 100])
  })

  it('handles values that decrease along the edge', () => {
    const found = crossings((x) => 590 - x * 5, 100, 100)
    expect(found.map((c) => c.value)).toEqual([500, 400, 300, 200, 100])
  })

  it('returns nothing when no multiple lies inside the edge', () => {
    expect(crossings(() => 130, 100, 100)).toEqual([])
  })
})

describe('scale bar', () => {
  it('picks the largest 1-2-5 distance that fits', () => {
    expect(niceDistance(130)).toBe(100)
    expect(niceDistance(250)).toBe(200)
    expect(niceDistance(7_400)).toBe(5_000)
    expect(niceDistance(19_999)).toBe(10_000)
  })

  it('formats metres and kilometres', () => {
    expect(formatDistance(500)).toBe('500 m')
    expect(formatDistance(20_000)).toBe('20 km')
  })

  it('shrinks the metres per pixel by half per zoom level', () => {
    expect(metresPerPixel(46, 6) / metresPerPixel(46, 7)).toBeCloseTo(2, 6)
  })
})
