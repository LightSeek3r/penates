import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { STATION_DISTANCE_PROPERTY, type LayerDef, layersByGroup, readLayerValue, visibleLayers } from '../domain/layers'
import { CONFIDENCE, TREND_YEARS, readPlace } from '../domain/place'
import { useAppStore } from '../state/appStore'
import type { Lang } from '../state/urlState'
import { formatChange, formatNumber, formatPeriod } from './format'
import { type Translate, formatLayerValue } from './layerText'
import { Sparkline } from './Sparkline'

const PIPS = [CONFIDENCE.low, CONFIDENCE.medium, CONFIDENCE.high]

function isDoubtful(def: LayerDef, props: Record<string, unknown>): boolean {
  const reliability = def.doubt ? props[def.doubt.property] : undefined
  return def.doubt !== undefined && typeof reliability === 'number' && reliability < def.doubt.below
}

function rowText(t: Translate, def: LayerDef, value: number, props: Record<string, unknown>, lang: Lang): string {
  const text = formatLayerValue(t, def, value, lang)
  return t('inspector.row', { name: t(`ind.${def.id}.name`), value: isDoubtful(def, props) ? `${text} (${t('inspector.doubt')})` : text })
}

/** Every indicator the commune has, grouped by family with each family's limits; absent ones are left out. */
function Indicators({ props }: { props: Record<string, unknown> }) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const showOptIn = useAppStore((state) => state.showOptIn)
  const base = useId()
  const sections = layersByGroup(visibleLayers(showOptIn).filter((def) => def.group !== 'price')).flatMap(({ group, layers }) => {
    const rows = layers.flatMap((def) => {
      const value = readLayerValue(def, props)
      return value === null ? [] : [{ id: def.id, text: rowText(t, def, value, props, lang) }]
    })
    return rows.length === 0 ? [] : [{ group, rows }]
  })
  if (sections.length === 0) return null
  const station = props[STATION_DISTANCE_PROPERTY]

  return (
    <div className="indicators">
      {sections.map(({ group, rows }) => (
        <div key={group} className="indicators__group" role="group" aria-labelledby={`${base}-${group}`}>
          <h3 id={`${base}-${group}`} className="indicators__title">
            {t(`groups.${group}.title`)}
          </h3>
          <ul className="indicators__list">
            {rows.map((row) => (
              <li key={row.id}>{row.text}</li>
            ))}
          </ul>
          <p className="indicators__note">
            {t(`groups.${group}.note`)}
            {group === 'climate' && typeof station === 'number' && Number.isFinite(station) && ` ${t('groups.climate.station', { value: formatNumber(station, lang) })}`}
          </p>
        </div>
      ))}
    </div>
  )
}

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

      {place.kind === 'commune' && <Indicators props={selection.props} />}

      <p className="inspector__disclaimer">{t('inspector.disclaimer')}</p>
    </section>
  )
}
