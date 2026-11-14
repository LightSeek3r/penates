import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CROSS_COLORS, MARK_DIAMETERS, TIERS, type Tier, crossColor, roughCondition } from '../domain/combine'
import { activeFilterCount } from '../domain/filters'
import { type LayerDef, layerById, layerColors } from '../domain/layers'
import { type OverlayId, type RiskOverlayId, SEISMIC_LEVELS, isPlaceKind, overlayById, riskLevels } from '../domain/overlays'
import { themeDef } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import type { Lang } from '../state/urlState'
import { formatNumber } from './format'
import { type Translate, className, legendRows, tierLabels } from './layerText'
import { OverlaySymbol, RiskLine } from './OverlaySymbol'

/** The hatch sample sits on a colour the map can actually show under it, never on another quantity's colour. */
const swatch = (colour: string) => ({ '--swatch': colour }) as CSSProperties

const canBeRough = (def: LayerDef) => roughCondition(def, 'all') !== null

function Ladder({ def }: { def: LayerDef }) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  return (
    <ol className="ladder">
      {legendRows(t, def, layerColors(def), lang).map((row) => (
        <li key={row.key} className="ladder__step">
          <span className="ladder__swatch" style={{ background: row.color }} aria-hidden="true" />
          <span className="ladder__label">{row.label}</span>
          <span className="ladder__short" aria-hidden="true">
            {row.short}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** What the fill's textures mean when it shows one indicator. */
function ThemeStates({ def }: { def: LayerDef }) {
  const { t } = useTranslation()
  const colours = layerColors(def)
  if (def.id === 'price') {
    return (
      <>
        <li className="state state--solid">{t('legend.solid')}</li>
        <li className="state state--low">{t('legend.low')}</li>
        <li className="state state--none">{t('legend.none')}</li>
        <li className="state state--nocov">{t('legend.noCoverage')}</li>
      </>
    )
  }
  return (
    <>
      {def.doubt && (
        <li className="state state--low" style={swatch(colours[Math.floor(colours.length / 2)])}>
          {t('legend.doubt')}
        </li>
      )}
      <li className="state state--nodata">{t('legend.noData')}</li>
    </>
  )
}

/** 3 x 3 key: rows are the second indicator's tiers (high on top), columns the theme's (high on the right). */
function CrossKey({ theme, second }: { theme: LayerDef; second: LayerDef }) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const base = useId()
  const columns = tierLabels(t, theme, lang)
  const rows = tierLabels(t, second, lang)
  const [themeName, secondName] = [t(`ind.${theme.id}.name`), t(`ind.${second.id}.name`)]
  const rowId = (tier: Tier) => `${base}-row-${tier}`
  const columnId = (tier: Tier) => `${base}-col-${tier}`

  return (
    <div className="cross">
      <p className="cross__axis">
        <Arrow direction="up" />
        {secondName}
      </p>
      <table className="cross__grid">
        <caption className="visually-hidden">{t('legend.crossCaption', { theme: themeName, second: secondName })}</caption>
        <tbody>
          {[...TIERS].reverse().map((row) => (
            <tr key={row}>
              <th scope="row" id={rowId(row)} className="cross__tier">
                <span className="cross__long">{rows[row].label}</span>
                <span className="cross__short">{rows[row].short}</span>
              </th>
              {TIERS.map((column) => (
                <td key={column} headers={`${rowId(row)} ${columnId(column)}`}>
                  <span className="cross__cell" style={{ background: crossColor(column, row) }} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td />
            {TIERS.map((column) => (
              <th key={column} scope="col" id={columnId(column)} className="cross__tier cross__tier--column">
                <span className="cross__long">{columns[column].label}</span>
                <span className="cross__short">{columns[column].short}</span>
              </th>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="cross__axis cross__axis--theme">
        {themeName}
        <Arrow direction="right" />
      </p>
    </div>
  )
}

function Arrow({ direction }: { direction: 'up' | 'right' }) {
  return (
    <svg className="cross__arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d={direction === 'up' ? 'M6 11V1M2 5l4-4 4 4' : 'M1 6h10M7 2l4 4-4 4'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/** Mirrors the map's dual-ink disc (map/patterns.ts) at the same sizes. */
function Disc({ tier, open = false }: { tier: Tier; open?: boolean }) {
  const diameter = MARK_DIAMETERS[tier]
  const size = MARK_DIAMETERS[2] + 3
  const centre = size / 2
  return (
    <svg className="disc" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      {open ? (
        <>
          <circle className="disc__edge" cx={centre} cy={centre} r={diameter / 2 - 1} />
          <circle className="disc__ring" cx={centre} cy={centre} r={diameter / 2 - 1} />
        </>
      ) : (
        <circle className="disc__core" cx={centre} cy={centre} r={diameter / 2} />
      )}
    </svg>
  )
}

function MarksKey({ second }: { second: LayerDef }) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const labels = tierLabels(t, second, lang)
  return (
    <>
      <h3 className="legend__second">{t(`ind.${second.id}.legend`)}</h3>
      <ul className="marks">
        {TIERS.map((tier) => (
          <li key={tier} className="marks__step">
            <Disc tier={tier} />
            <span className="ladder__label">{labels[tier].label}</span>
            <span className="ladder__short" aria-hidden="true">
              {labels[tier].short}
            </span>
          </li>
        ))}
        {canBeRough(second) && (
          <li className="marks__step">
            <Disc tier={1} open />
            {t('legend.marksRough')}
          </li>
        )}
        <li className="marks__step">
          <span className="marks__none" aria-hidden="true" />
          {t('legend.marksNone')}
        </li>
      </ul>
      <p className="legend__caveat">{t('legend.marksThinned')}</p>
    </>
  )
}

// Below this width the legend is the strip at the foot of the map (same breakpoint as app.css).
const PHONE = '(max-width: 719px)'
const isPhone = () => window.matchMedia(PHONE).matches
// Zone 5 occurs only overseas, which the map does not show.
const METROPOLITAN_LEVELS = SEISMIC_LEVELS.filter((level) => level < 5)

/** One label per line weight of a risk overlay: the zone a seismic line rises to, the class a commune value rises to, or a count of known cavities. */
function riskLevelLabels(t: Translate, id: RiskOverlayId, lang: Lang): string[] {
  if (id === 'seismic') return METROPOLITAN_LEVELS.map((level) => t('legend.seismicLevel', { value: level }))
  const def = layerById(id)
  const levels = riskLevels(id)
  if (def?.scale.kind === 'classes') return levels.map((code) => t(`ind.${id}.classLabel`, { value: code, name: className(t, def, code) }))
  return levels.map((count) => t('legend.knownCavities', { range: t('legend.over', { value: formatNumber(count, lang) }) }))
}

function OverlayEntry({ id }: { id: OverlayId }) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  if (isPlaceKind(id)) {
    return (
      <li className="ov-key__row">
        <OverlaySymbol id={id} />
        <span>{t(`ov.${id}.name`)}</span>
      </li>
    )
  }
  return (
    <li className="ov-key__risk">
      <span>{t(`ov.${id}.name`)}</span>
      <ul className="ov-key__levels">
        {riskLevelLabels(t, id, lang).map((label, step) => (
          <li key={label} className="ov-key__row">
            <RiskLine id={id} step={step} />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * Key of the overlays switched on, folded under the colour legend. On phones it starts closed as a chip in the strip,
 * and opening it closes the layers sheet, so two bottom sheets never stand over each other.
 */
function OverlayKey() {
  const { t } = useTranslation()
  const overlays = useAppStore((state) => state.overlays)
  const layersOpen = useAppStore((state) => state.layersOpen)
  const setLayersOpen = useAppStore((state) => state.setLayersOpen)
  const [open, setOpen] = useState(() => !isPhone())
  // Opening the layers sheet on a phone folds the key back into its chip (state adjusted while rendering).
  const [layersSeen, setLayersSeen] = useState(layersOpen)
  if (layersOpen !== layersSeen) {
    setLayersSeen(layersOpen)
    if (layersOpen && isPhone()) setOpen(false)
  }

  const shown = overlays.filter((id) => overlayById(id) !== undefined)
  if (shown.length === 0) return null
  return (
    <details
      className="ov-key"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next === open) return
        setOpen(next)
        if (next && layersOpen && isPhone()) setLayersOpen(false)
      }}
    >
      <summary className="ov-key__head">
        <span>{t('legend.overlays', { count: shown.length })}</span>
        <svg className="group__chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </summary>
      {/* The body scrolls on its own on phones, so an open key never takes more than its share of the screen. */}
      <div className="ov-key__body">
        <ul className="ov-key__list">
          {shown.map((id) => (
            <OverlayEntry key={id} id={id} />
          ))}
        </ul>
        {/* Said once for all the risk lines, after them. */}
        {shown.some((id) => !isPlaceKind(id)) && <p className="legend__caveat">{t('legend.riskMeaning')}</p>}
      </div>
    </details>
  )
}

/**
 * Publishes the legend's height on the stage as `--legend-height`, so on phones the details sheet sits just above the
 * strip however many rows the strip has (a second indicator, filters, the overlay chip) and never covers it.
 */
function useLegendHeight() {
  const legend = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = legend.current
    const stage = element?.closest<HTMLElement>('.stage')
    if (!element || !stage) return
    const observer = new ResizeObserver(() => stage.style.setProperty('--legend-height', `${element.offsetHeight}px`))
    observer.observe(element)
    return () => {
      observer.disconnect()
      stage.style.removeProperty('--legend-height')
    }
  }, [])
  return legend
}

export function Legend() {
  const { t } = useTranslation()
  const theme = themeDef(useAppStore((state) => state.theme))
  const compare = useAppStore((state) => state.compare)
  const mix = useAppStore((state) => state.mix)
  const filtered = activeFilterCount(useAppStore((state) => state.filters)) > 0
  const second = compare === null ? null : themeDef(compare)
  const cross = second !== null && mix === 'cross'
  const title = cross ? t('legend.crossTitle', { theme: t(`ind.${theme.id}.name`), second: t(`ind.${second.id}.name`) }) : t(`ind.${theme.id}.legend`)
  const optIn = [theme, second].find((def) => def?.optIn)
  const strip = useLegendHeight()

  return (
    <section ref={strip} className="panel legend" aria-label={title}>
      <h2 className="panel__title">{title}</h2>
      {cross ? <CrossKey theme={theme} second={second} /> : <Ladder def={theme} />}
      {theme.id === 'price' && !cross && <h3 className="legend__subtitle">{t('legend.stateTitle')}</h3>}
      <ul className="states">
        {cross ? (
          <>
            {(canBeRough(theme) || canBeRough(second)) && (
              <li className="state state--low" style={swatch(CROSS_COLORS[1][1])}>
                {t('legend.crossRough')}
              </li>
            )}
            {[theme, second].some((def) => def.id === 'price') && (
              <>
                <li className="state state--none">{t('legend.none')}</li>
                <li className="state state--nocov">{t('legend.noCoverage')}</li>
              </>
            )}
            <li className="state state--nodata">{t('legend.crossNoData')}</li>
          </>
        ) : (
          <ThemeStates def={theme} />
        )}
        {filtered && <li className="state state--dimmed">{t('legend.dimmed')}</li>}
      </ul>
      {cross && <p className="legend__caveat">{t('legend.tiersNote')}</p>}
      {second !== null && !cross && <MarksKey second={second} />}
      {optIn && <p className="legend__caveat">{t(`groups.${optIn.group}.note`)}</p>}
      <OverlayKey />
    </section>
  )
}
