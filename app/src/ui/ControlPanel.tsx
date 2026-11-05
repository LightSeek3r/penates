import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FILTER_DEFS, activeFilterCount } from '../domain/filters'
import { PRICE_TYPES } from '../domain/place'
import { DISTANCE_THEMES, type ThemeId } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { formatNumber } from './format'

type Tab = 'colour' | 'filters'
const TABS: readonly Tab[] = ['colour', 'filters']

const GROUPS: ReadonlyArray<{ label: string; themes: readonly ThemeId[] }> = [
  { label: 'groupPrice', themes: ['price'] },
  { label: 'groupRisk', themes: ['seismic'] },
  { label: 'groupAccess', themes: DISTANCE_THEMES },
]

function ThemeList() {
  const { t } = useTranslation()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const priceType = useAppStore((state) => state.priceType)
  const setPriceType = useAppStore((state) => state.setPriceType)

  return (
    <fieldset className="themes">
      <legend className="visually-hidden">{t('layers.colourBy')}</legend>
      {GROUPS.map((group) => (
        <div key={group.label} className="themes__group">
          <p className="themes__label">{t(`layers.${group.label}`)}</p>
          {group.themes.map((candidate) => (
            <label key={candidate} className="theme">
              <input type="radio" name="theme" value={candidate} checked={theme === candidate} onChange={() => setTheme(candidate)} />
              <span>{t(`themes.${candidate}`)}</span>
            </label>
          ))}
        </div>
      ))}
      {theme === 'price' && (
        <fieldset className="segmented">
          <legend>{t('layers.typeLabel')}</legend>
          {PRICE_TYPES.map((type) => (
            <label key={type} className="segmented__option">
              <input type="radio" name="price-type" value={type} checked={priceType === type} onChange={() => setPriceType(type)} />
              <span>{t(`layers.type.${type}`)}</span>
            </label>
          ))}
        </fieldset>
      )}
    </fieldset>
  )
}

function FilterList() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const filters = useAppStore((state) => state.filters)
  const setFilter = useAppStore((state) => state.setFilter)
  const resetFilters = useAppStore((state) => state.resetFilters)
  const base = useId()

  const valueText = (key: (typeof FILTER_DEFS)[number]['key'], value: number, max: number) => {
    if (value >= max) return t('filters.any')
    if (key === 'price') return t('filters.upTo', { value: `${formatNumber(value, lang)} €/m²` })
    if (key === 'seismic') return t('filters.zoneUpTo', { value })
    return t('filters.upTo', { value: `${value / 1000} km` })
  }

  return (
    <div className="filters">
      <p className="filters__intro">{t('filters.intro')}</p>
      {FILTER_DEFS.map((def) => {
        const value = filters[def.key] ?? def.max
        const text = valueText(def.key, value, def.max)
        return (
          <div key={def.key} className="filter" data-active={filters[def.key] !== undefined}>
            <label htmlFor={`${base}-${def.key}`}>{t(`filters.${def.key}`)}</label>
            <output htmlFor={`${base}-${def.key}`}>{text}</output>
            <input
              id={`${base}-${def.key}`}
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={value}
              aria-valuetext={text}
              onChange={(event) => setFilter(def.key, Number(event.target.value))}
            />
          </div>
        )
      })}
      <p className="filters__note">{t('filters.unknown')}</p>
      <button type="button" className="button" disabled={activeFilterCount(filters) === 0} onClick={resetFilters}>
        {t('filters.reset')}
      </button>
    </div>
  )
}

export function ControlPanel() {
  const { t } = useTranslation()
  const open = useAppStore((state) => state.layersOpen)
  const setOpen = useAppStore((state) => state.setLayersOpen)
  const count = activeFilterCount(useAppStore((state) => state.filters))
  const [tab, setTab] = useState<Tab>('colour')
  const base = useId()

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next)
    document.getElementById(`${base}-tab-${next}`)?.focus()
  }

  return (
    <section className="panel layers controls" data-open={open} aria-label={t('layers.open')}>
      <div className="controls__bar">
        <div role="tablist" className="tabs" aria-label={t('layers.title')} onKeyDown={onKeyDown}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${base}-tab-${id}`}
              className="tab"
              aria-selected={tab === id}
              aria-controls={`${base}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {t(id === 'colour' ? 'layers.colourTab' : 'layers.filtersTab')}
              {id === 'filters' && count > 0 && <span className="badge">{count}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="button button--quiet layers__close" onClick={() => setOpen(false)}>
          {t('layers.close')}
        </button>
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className="controls__body">
        {tab === 'colour' ? <ThemeList /> : <FilterList />}
      </div>
    </section>
  )
}

