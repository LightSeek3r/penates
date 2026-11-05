import { TREND_YEARS } from '../domain/place'

const WIDTH = 160
const HEIGHT = 44
const PAD = 6

export function Sparkline({ values }: { values: (number | null)[] }) {
  const known = values.flatMap((value, index) => (value === null ? [] : [{ value, index }]))
  if (known.length < 2) return null

  // The y-range is at least +/-20 % around the mean, so a flat trend is drawn flat and the line
  // never claims a bigger swing than the caption's values.
  const mean = known.reduce((sum, point) => sum + point.value, 0) / known.length
  const min = Math.min(mean * 0.8, ...known.map((point) => point.value))
  const max = Math.max(mean * 1.2, ...known.map((point) => point.value))
  const span = max - min
  const x = (index: number) => PAD + (index / (TREND_YEARS.length - 1)) * (WIDTH - PAD * 2)
  const y = (value: number) => HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2)
  const points = known.map((point) => `${x(point.index)},${y(point.value)}`).join(' ')

  return (
    <svg className="sparkline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={known.map((p) => `${TREND_YEARS[p.index]}: ${Math.round(p.value)}`).join(', ')}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" />
      {known.map((point) => (
        <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r="2.2" fill="currentColor" />
      ))}
    </svg>
  )
}
