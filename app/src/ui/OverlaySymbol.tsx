import { type OverlayId, type PlaceKindId, RISK_STYLE, type RiskOverlayId, isPlaceKind } from '../domain/overlays'
import { placeIconSpec } from '../map/placeIcons'

// As wide as the legend swatches, so samples and swatches line up.
const SAMPLE = { width: 32, height: 12 }
/** Midnight casing on each side of the ink, as on the map, so the sample reads the same on every fill. */
const CASING = 1.5
const BADGE = 20

/**
 * A short length of the map line: casing first, then the ink with its dash. `step` picks one of the style's widths
 * (a seismic level or a class step); without it the sample uses the middle one.
 */
export function RiskLine({ id, step }: { id: RiskOverlayId; step?: number }) {
  const style = RISK_STYLE[id]
  const width = style.widths[step ?? Math.floor((style.widths.length - 1) / 2)]
  const y = SAMPLE.height / 2
  return (
    <svg className="ov-symbol" viewBox={`0 0 ${SAMPLE.width} ${SAMPLE.height}`} width={SAMPLE.width} height={SAMPLE.height} aria-hidden="true">
      <line x1="1" x2={SAMPLE.width - 1} y1={y} y2={y} stroke="var(--ground)" strokeWidth={width + CASING * 2} />
      <line x1="1" x2={SAMPLE.width - 1} y1={y} y2={y} stroke={style.ink} strokeWidth={width} strokeDasharray={style.dash?.map((length) => length * width).join(' ')} />
    </svg>
  )
}

/** The map's badge for a place kind (midnight casing, porcelain ring, family ink, pictogram), from the same spec. */
export function PlaceBadge({ kind, size = BADGE }: { kind: PlaceKindId; size?: number }) {
  const spec = placeIconSpec(kind, 'glyph')
  const centre = spec.size / 2
  return (
    <svg className="ov-symbol" viewBox={`0 0 ${spec.size} ${spec.size}`} width={size} height={size} aria-hidden="true">
      {spec.discs.map((disc) => (
        <circle key={disc.radius} cx={centre} cy={centre} r={disc.radius} fill={disc.ink} />
      ))}
      {spec.glyph && <path d={spec.glyph.path} fill={spec.glyph.ink} transform={`translate(${spec.glyph.x} ${spec.glyph.y}) scale(${spec.glyph.scale})`} />}
    </svg>
  )
}

export function OverlaySymbol({ id }: { id: OverlayId }) {
  return isPlaceKind(id) ? <PlaceBadge kind={id} /> : <RiskLine id={id} />
}
