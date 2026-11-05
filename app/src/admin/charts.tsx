import type { Share, VitalSplit } from './types'

import { formatCount } from './format'

const WIDTH = 640
const HEIGHT = 140
const PAD = 4

/** Daily bars. The accessible name lists the totals; the visible axis shows the first and last day. */
export function DailyBars({ days, values, label }: { days: string[]; values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  const slot = (WIDTH - PAD * 2) / values.length
  const total = values.reduce((sum, value) => sum + value, 0)
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${label} : ${formatCount(total)} au total, du ${days[0]} au ${days.at(-1)}`} preserveAspectRatio="none">
        {values.map((value, index) => {
          const height = (value / max) * (HEIGHT - PAD * 2)
          return (
            <rect key={days[index]} x={PAD + index * slot + 1} y={HEIGHT - PAD - height} width={Math.max(1, slot - 2)} height={height} rx="1">
              <title>{`${days[index]} : ${formatCount(value)}`}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption>
        <span>{days[0]}</span>
        <span>max {formatCount(max)}</span>
        <span>{days.at(-1)}</span>
      </figcaption>
    </figure>
  )
}

/** Ranked horizontal bars with their counts. */
export function BarList({ items, empty }: { items: Share[]; empty: string }) {
  if (items.length === 0) return <p className="muted">{empty}</p>
  const max = Math.max(1, ...items.map((item) => item.n))
  return (
    <ul className="bars">
      {items.map((item) => (
        <li key={item.key}>
          <span className="bars__key">{item.key}</span>
          <span className="bars__track" aria-hidden="true">
            <span className="bars__fill" style={{ width: `${(item.n / max) * 100}%` }} />
          </span>
          <span className="bars__n">{formatCount(item.n)}</span>
        </li>
      ))}
    </ul>
  )
}

const percent = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100))

/** Share of loads rated good, needs improvement and poor, as one stacked bar. */
export function VitalBar({ split, label }: { split: VitalSplit; label: string }) {
  const total = split.good + split.ni + split.poor
  if (total === 0) return <span className="muted">—</span>
  return (
    <span className="vital" role="img" aria-label={`${label} : ${percent(split.good, total)} % bon, ${percent(split.ni, total)} % à améliorer, ${percent(split.poor, total)} % mauvais, sur ${formatCount(total)} chargements`}>
      <span className="vital__good" style={{ width: `${percent(split.good, total)}%` }} />
      <span className="vital__ni" style={{ width: `${percent(split.ni, total)}%` }} />
      <span className="vital__poor" style={{ width: `${percent(split.poor, total)}%` }} />
    </span>
  )
}
