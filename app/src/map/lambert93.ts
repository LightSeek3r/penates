// RGF93 / Lambert-93 (EPSG:2154), formulas from IGN NTG 71 (Lambert conformal conic, two standard parallels).
const A = 6378137
const E2 = 0.0066943800229
const E = Math.sqrt(E2)
const LON0 = (3 * Math.PI) / 180
const LAT0 = (46.5 * Math.PI) / 180
const LAT1 = (44 * Math.PI) / 180
const LAT2 = (49 * Math.PI) / 180
const E0 = 700000
const N0 = 6600000

const m = (lat: number) => Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
const t = (lat: number) => Math.tan(Math.PI / 4 - lat / 2) / ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2)

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)))
const F = m(LAT1) / (N * t(LAT1) ** N)
const RHO0 = A * F * t(LAT0) ** N

export interface Lambert {
  easting: number
  northing: number
}

export function toLambert93(lng: number, lat: number): Lambert {
  const rho = A * F * t((lat * Math.PI) / 180) ** N
  const theta = N * ((lng * Math.PI) / 180 - LON0)
  return { easting: E0 + rho * Math.sin(theta), northing: N0 + RHO0 - rho * Math.cos(theta) }
}

export function fromLambert93(easting: number, northing: number): { lng: number; lat: number } {
  const dx = easting - E0
  const dy = RHO0 - (northing - N0)
  const rho = Math.sign(N) * Math.hypot(dx, dy)
  const theta = Math.atan2(Math.sign(N) * dx, Math.sign(N) * dy)
  const tPrime = (rho / (A * F)) ** (1 / N)
  let lat = Math.PI / 2 - 2 * Math.atan(tPrime)
  for (let i = 0; i < 8; i += 1) {
    lat = Math.PI / 2 - 2 * Math.atan(tPrime * ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2))
  }
  return { lng: ((theta / N + LON0) * 180) / Math.PI, lat: (lat * 180) / Math.PI }
}
