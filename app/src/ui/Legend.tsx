import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { activeFilterCount } from '../domain/filters'
import { layerColors } from '../domain/layers'
import { themeDef } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { legendRows } from './layerText'

export function Legend() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const theme = useAppStore((state) => state.theme)
  const filtered = activeFilterCount(useAppStore((state) => state.filters)) > 0

  const def = themeDef(theme)
  const colours = layerColors(def)
  const price = def.id === 'price'
  const title = t(`ind.${def.id}.legend`)
  const rows = legendRows(t, def, colours, lang)
  // The hatch sample sits on a mid class of the theme's own ladder, never on another quantity's colour.
  const doubtSwatch = { '--swatch': colours[Math.floor(colours.length / 2)] } as CSSProperties

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
      {price && <h3 className="legend__subtitle">{t('legend.stateTitle')}</h3>}
      <ul className="states">
        {price ? (
          <>
            <li className="state state--solid">{t('legend.solid')}</li>
            <li className="state state--low">{t('legend.low')}</li>
            <li className="state state--none">{t('legend.none')}</li>
            <li className="state state--nocov">{t('legend.noCoverage')}</li>
          </>
        ) : (
          <>
            {def.doubt && (
              <li className="state state--low" style={doubtSwatch}>
                {t('legend.doubt')}
              </li>
            )}
            <li className="state state--nodata">{t('legend.noData')}</li>
          </>
        )}
        {filtered && <li className="state state--dimmed">{t('legend.dimmed')}</li>}
      </ul>
      {def.optIn && <p className="legend__caveat">{t(`groups.${def.group}.note`)}</p>}
    </section>
  )
}
