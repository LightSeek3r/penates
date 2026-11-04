import { useTranslation } from 'react-i18next'
import { PRICE_BREAKS, PRICE_COLORS } from '../domain/priceLadder'
import { useAppStore } from '../state/appStore'
import { formatCompact, formatNumber } from './format'

export function Legend() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const last = PRICE_BREAKS.length

  const label = (index: number) => {
    if (index === 0) return t('legend.under', { value: formatNumber(PRICE_BREAKS[0], lang) })
    if (index === last) return t('legend.over', { value: formatNumber(PRICE_BREAKS[last - 1], lang) })
    return t('legend.range', { from: formatNumber(PRICE_BREAKS[index - 1], lang), to: formatNumber(PRICE_BREAKS[index], lang) })
  }

  const short = (index: number) => {
    if (index === 0) return `<${formatCompact(PRICE_BREAKS[0], lang)}`
    if (index === last) return `${formatCompact(PRICE_BREAKS[last - 1], lang)}+`
    return formatCompact(PRICE_BREAKS[index - 1], lang)
  }

  return (
    <section className="panel legend" aria-label={t('legend.title')}>
      <h2 className="panel__title">{t('legend.title')}</h2>
      <ol className="ladder">
        {PRICE_COLORS.map((color, index) => (
          <li key={color} className="ladder__step">
            <span className="ladder__swatch" style={{ background: color }} aria-hidden="true" />
            <span className="ladder__label">{label(index)}</span>
            <span className="ladder__short" aria-hidden="true">
              {short(index)}
            </span>
          </li>
        ))}
      </ol>
      <h3 className="legend__subtitle">{t('legend.stateTitle')}</h3>
      <ul className="states">
        <li className="state state--solid">{t('legend.solid')}</li>
        <li className="state state--low">{t('legend.low')}</li>
        <li className="state state--none">{t('legend.none')}</li>
        <li className="state state--nocov">{t('legend.noCoverage')}</li>
      </ul>
    </section>
  )
}
