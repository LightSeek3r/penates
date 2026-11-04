import { useTranslation } from 'react-i18next'
import { CONFIDENCE, readPlace } from '../domain/place'
import { useAppStore } from '../state/appStore'
import { formatNumber } from './format'
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

  return (
    <section className="panel inspector" aria-label={t('inspector.title')}>
      <div className="panel__head">
        <div>
          <h2 className="inspector__name">{place.name}</h2>
          <p className="inspector__meta">{place.kind === 'department' ? t('inspector.department') : place.dep}</p>
        </div>
        <button type="button" className="button button--quiet" aria-label={t('inspector.close')} onClick={() => select(null)}>
          ×
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
            <dt>{t('inspector.sales', { count: place.sales })}</dt>
          </div>
          <div>
            <dt>{t('inspector.window', { months: place.windowMonths })}</dt>
          </div>
          {place.period && (
            <div>
              <dt>{t('inspector.period', { period: place.period })}</dt>
            </div>
          )}
        </dl>
      )}

      {place.kind === 'commune' && covered && (
        <div className="trend">
          <p className="trend__label">{t('inspector.trend')}</p>
          {place.trend.filter((value) => value !== null).length >= 2 ? <Sparkline values={place.trend} /> : <p className="trend__missing">{t('inspector.trendMissing')}</p>}
        </div>
      )}

      <p className="inspector__disclaimer">{t('inspector.disclaimer')}</p>
    </section>
  )
}
