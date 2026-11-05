import { useTranslation } from 'react-i18next'
import { CONFIDENCE, TREND_YEARS, readIndicators, readPlace } from '../domain/place'
import { DISTANCE_THEMES } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { formatChange, formatNumber, formatPeriod } from './format'
import { Sparkline } from './Sparkline'

const PIPS = [CONFIDENCE.low, CONFIDENCE.medium, CONFIDENCE.high]

export function Inspector() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const priceType = useAppStore((state) => state.priceType)
  const selection = useAppStore((state) => state.selection)
  const select = useAppStore((state) => state.select)

  if (!selection) {
    return (
      <section className="panel inspector inspector--empty" aria-label={t('inspector.title')}>
        <p className="inspector__hint">{t('inspector.empty')}</p>
      </section>
    )
  }

  const place = readPlace(selection.props, priceType, selection.kind)
  const covered = place.confidence !== CONFIDENCE.noCoverage
  const period = place.period ? formatPeriod(place.period, lang) : null
  const known = place.trend.flatMap((value, index) => (value === null ? [] : [{ value, year: TREND_YEARS[index] }]))
  const indicators = readIndicators(selection.props)
  const distanceThemes = DISTANCE_THEMES.filter((theme) => indicators.distances[theme] !== undefined)
  const first = known[0]
  const last = known.at(-1)

  return (
    <section className="panel inspector" aria-label={t('inspector.title')}>
      <div className="panel__head">
        <div>
          <h2 className="inspector__name">{place.name}</h2>
          <p className="inspector__meta">{place.kind === 'department' ? t('inspector.department') : place.dep}</p>
        </div>
        <button type="button" className="button button--quiet button--icon" aria-label={t('inspector.close')} onClick={() => select(null)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>

      <div aria-live="polite">
        {place.price !== null ? (
          <p className="inspector__price">
            <span className="inspector__value">{formatNumber(place.price, lang)}</span>
            <span className="inspector__unit">{t('inspector.unit')}</span>
          </p>
        ) : (
          <p className="inspector__noprice">{t('inspector.noPrice')}</p>
        )}

        <div className={`meter meter--c${place.confidence}`} aria-hidden="true">
          {covered ? PIPS.map((pip) => <span key={pip} className="meter__pip" data-on={place.confidence >= pip} />) : <span className="meter__nocov" />}
        </div>
        <p className="inspector__confidence">{t(`inspector.confidence.${place.confidence}`)}</p>
      </div>

      {covered && (
        <dl className="facts">
          <div>
            <dt>{t('inspector.sales', { value: formatNumber(place.sales, lang) })}</dt>
          </div>
          {period && (
            <div>
              <dt>{t('inspector.period', { period })}</dt>
            </div>
          )}
          {place.windowMonths !== 36 && (
            <div>
              <dt>{t('inspector.windowWide', { months: place.windowMonths })}</dt>
            </div>
          )}
        </dl>
      )}

      {place.kind === 'commune' && covered && (
        <div className="trend">
          <p className="trend__label">{t('inspector.trend')}</p>
          {first && last && known.length >= 2 ? (
            <>
              <Sparkline values={place.trend} />
              <p className="trend__range">
                {t('inspector.trendRange', {
                  fromYear: first.year,
                  from: formatNumber(first.value, lang),
                  toYear: last.year,
                  to: formatNumber(last.value, lang),
                  change: formatChange(first.value, last.value, lang),
                })}
              </p>
            </>
          ) : (
            <p className="trend__missing">{t('inspector.trendMissing')}</p>
          )}
        </div>
      )}

      {place.kind === 'commune' && (indicators.seismicZone !== null || distanceThemes.length > 0) && (
        <div className="indicators">
          {indicators.seismicZone !== null && (
            <p className="indicators__seismic">{t('inspector.seismic', { zone: indicators.seismicZone, name: t(`seismic.${indicators.seismicZone}`) })}</p>
          )}
          {distanceThemes.length > 0 && (
            <>
              <p className="trend__label">{t('inspector.indicators')}</p>
              <ul className="indicators__list">
                {distanceThemes.map((theme) => (
                  <li key={theme}>
                    {t('inspector.distance', {
                      theme: t(`themes.${theme}`),
                      value: new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((indicators.distances[theme] ?? 0) / 1000),
                    })}
                  </li>
                ))}
              </ul>
              <p className="trend__label">{t('inspector.distanceNote')}</p>
            </>
          )}
        </div>
      )}

      <p className="inspector__disclaimer">{t('inspector.disclaimer')}</p>
    </section>
  )
}
