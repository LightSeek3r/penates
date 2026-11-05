import { useTranslation } from 'react-i18next'
import { activeFilterCount } from '../domain/filters'
import { PRICE_BREAKS, PRICE_COLORS } from '../domain/priceLadder'
import { DISTANCE_BREAKS, DISTANCE_COLORS, SEISMIC_COLORS, SEISMIC_ZONES } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { formatCompact, formatNumber } from './format'

interface Row {
  key: string
  color: string
  label: string
  short: string
}

type Translate = ReturnType<typeof useTranslation>['t']

function ladderRows(t: Translate, lang: 'fr' | 'en'): Row[] {
  const last = PRICE_BREAKS.length
  return PRICE_COLORS.map((color, index) => {
    const label =
      index === 0
        ? t('legend.under', { value: formatNumber(PRICE_BREAKS[0], lang) })
        : index === last
          ? t('legend.over', { value: formatNumber(PRICE_BREAKS[last - 1], lang) })
          : t('legend.range', { from: formatNumber(PRICE_BREAKS[index - 1], lang), to: formatNumber(PRICE_BREAKS[index], lang) })
    const short = index === 0 ? `<${formatCompact(PRICE_BREAKS[0], lang)}` : index === last ? `${formatCompact(PRICE_BREAKS[last - 1], lang)}+` : formatCompact(PRICE_BREAKS[index - 1], lang)
    return { key: color, color, label, short }
  })
}

function distanceRows(t: Translate): Row[] {
  const last = DISTANCE_BREAKS.length
  const km = (metres: number) => metres / 1000
  return DISTANCE_COLORS.map((color, index) => {
    const label =
      index === 0
        ? t('legend.underKm', { value: km(DISTANCE_BREAKS[0]) })
        : index === last
          ? t('legend.overKm', { value: km(DISTANCE_BREAKS[last - 1]) })
          : t('legend.rangeKm', { from: km(DISTANCE_BREAKS[index - 1]), to: km(DISTANCE_BREAKS[index]) })
    const short = index === 0 ? `<${km(DISTANCE_BREAKS[0])}` : index === last ? `${km(DISTANCE_BREAKS[last - 1])}+` : String(km(DISTANCE_BREAKS[index - 1]))
    return { key: color, color, label, short }
  })
}

function seismicRows(t: Translate): Row[] {
  return SEISMIC_ZONES.map((zone, index) => ({
    key: String(zone),
    color: SEISMIC_COLORS[index],
    label: t('legend.zone', { zone, name: t(`seismic.${zone}`) }),
    short: String(zone),
  }))
}

export function Legend() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const theme = useAppStore((state) => state.theme)
  const filtered = activeFilterCount(useAppStore((state) => state.filters)) > 0

  const title =
    theme === 'price' ? t('legend.title') : theme === 'seismic' ? t('legend.seismicTitle') : t('legend.distanceTitle', { theme: t(`themes.${theme}`).toLowerCase() })
  const rows = theme === 'price' ? ladderRows(t, lang) : theme === 'seismic' ? seismicRows(t) : distanceRows(t)

  return (
    <section className="panel legend" aria-label={title}>
      <h2 className="panel__title">{title}</h2>
      <ol className="ladder">
        {rows.map((row) => (
          <li key={row.key} className="ladder__step">
            <span className="ladder__swatch" style={{ background: row.color }} aria-hidden="true" />
            <span className="ladder__label">{row.label}</span>
            <span className="ladder__short" aria-hidden="true">
              {row.short}
            </span>
          </li>
        ))}
      </ol>
      {theme === 'price' && <h3 className="legend__subtitle">{t('legend.stateTitle')}</h3>}
      <ul className="states">
        {theme === 'price' ? (
          <>
            <li className="state state--solid">{t('legend.solid')}</li>
            <li className="state state--low">{t('legend.low')}</li>
            <li className="state state--none">{t('legend.none')}</li>
            <li className="state state--nocov">{t('legend.noCoverage')}</li>
          </>
        ) : (
          <li className="state state--nodata">{t('legend.noData')}</li>
        )}
        {filtered && <li className="state state--dimmed">{t('legend.dimmed')}</li>}
      </ul>
    </section>
  )
}
