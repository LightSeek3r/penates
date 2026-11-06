import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { type FilterDef, type FilterKey, type FilterValue, activeFilterCount, isFilterable } from '../domain/filters'
import { type LayerDef, type LayerGroup, layersByGroup, visibleLayers } from '../domain/layers'
import { PRICE_TYPES } from '../domain/place'
import type { ThemeId } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { className, filterValueText } from './layerText'

type Tab = 'colour' | 'filters'
const TABS: readonly Tab[] = ['colour', 'filters']

function Chevron() {
  return (
    <svg className="group__chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

interface GroupProps {
  group: LayerGroup
  /** Single-entry groups are always shown: collapsing one line would only cost a click. */
  collapsible: boolean
  open: boolean
  onOpen: (group: LayerGroup | null) => void
  meta?: ReactNode
  children: ReactNode
}

/** One heading per indicator family; one tab stop (its summary) when closed, opening one closes the others. */
function Group({ group, collapsible, open, onOpen, meta, children }: GroupProps) {
  const { t } = useTranslation()
  const title = t(`groups.${group}.title`)
  if (!collapsible) {
    return (
      <div className="group group--fixed" role="group" aria-label={title}>
        <p className="group__head">
          <span className="group__title">{title}</span>
          {meta}
        </p>
        <div className="group__body">{children}</div>
      </div>
    )
  }
  return (
    <details
      className="group"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen(group)
        else if (open) onOpen(null)
      }}
    >
      <summary className="group__head">
        <span className="group__title">{title}</span>
        {meta}
        <Chevron />
      </summary>
      <div className="group__body">{children}</div>
    </details>
  )
}

function OptInSwitch() {
  const { t } = useTranslation()
  const showOptIn = useAppStore((state) => state.showOptIn)
  const setShowOptIn = useAppStore((state) => state.setShowOptIn)
  return (
    <div className="optin">
      <label className="theme">
        <input type="checkbox" checked={showOptIn} onChange={(event) => setShowOptIn(event.target.checked)} />
        <span>{t('optIn.label')}</span>
      </label>
      <p className="optin__note">{t('optIn.note')}</p>
    </div>
  )
}

function ThemeList() {
  const { t } = useTranslation()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const priceType = useAppStore((state) => state.priceType)
  const setPriceType = useAppStore((state) => state.setPriceType)
  const showOptIn = useAppStore((state) => state.showOptIn)
  const groups = layersByGroup(visibleLayers(showOptIn))
  const current = groups.find((entry) => entry.layers.some((def) => def.id === theme))?.group ?? null
  const [open, setOpen] = useState<LayerGroup | null>(current)
  const base = useId()

  return (
    <>
      <fieldset className="themes">
        <legend className="visually-hidden">{t('layers.colourBy')}</legend>
        {groups.map(({ group, layers }) => (
          <Group
            key={group}
            group={group}
            collapsible={layers.length > 1}
            open={open === group}
            onOpen={setOpen}
            meta={group === current && layers.length > 1 ? <span className="group__meta">{t(`ind.${theme}.name`)}</span> : undefined}
          >
            {layers.map((def) => (
              <div key={def.id}>
                <label className="theme">
                  <input
                    type="radio"
                    name="theme"
                    value={def.id}
                    checked={theme === def.id}
                    aria-describedby={theme === def.id && def.id !== 'price' ? `${base}-about` : undefined}
                    onChange={() => setTheme(def.id as ThemeId)}
                  />
                  <span>{t(`ind.${def.id}.name`)}</span>
                </label>
                {/* What the chosen layer means and where it stops being reliable. */}
                {theme === def.id && def.id !== 'price' && (
                  <p id={`${base}-about`} className="theme__about">
                    {t(`ind.${def.id}.about`)}
                  </p>
                )}
              </div>
            ))}
            {group === 'price' && theme === 'price' && (
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
          </Group>
        ))}
      </fieldset>
      <OptInSwitch />
    </>
  )
}

interface ControlProps {
  def: FilterDef
  value: FilterValue | undefined
  id: string
  onChange: (value: FilterValue) => void
}

function SliderControl({ def, value, id, onChange }: ControlProps) {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const spec = def.filter
  if (spec.kind === 'classes') return null
  const text = filterValueText(t, def, value, lang)
  const label = t(`ind.${def.id}.filter`)

  if (spec.kind === 'range') {
    const [from, to] = Array.isArray(value) && value.length === 2 ? value : [spec.min, spec.max]
    return (
      <>
        <span className="filter__label" id={`${id}-label`}>
          {label}
        </span>
        <output aria-live="off">{text}</output>
        {(['from', 'to'] as const).map((end) => (
          <input
            key={end}
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={end === 'from' ? from : to}
            aria-label={t(end === 'from' ? 'filters.rangeFrom' : 'filters.rangeTo', { name: label })}
            aria-valuetext={text}
            onChange={(event) => {
              const next = Number(event.target.value)
              onChange(end === 'from' ? [Math.min(next, to), to] : [from, Math.max(next, from)])
            }}
          />
        ))}
      </>
    )
  }

  const off = spec.kind === 'max' ? spec.max : spec.min
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{text}</output>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={typeof value === 'number' ? value : off}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </>
  )
}

function ClassesControl({ def, value, onChange }: ControlProps) {
  const { t } = useTranslation()
  if (def.scale.kind !== 'classes') return null
  const picked = Array.isArray(value) ? value : def.scale.values
  return (
    <fieldset className="filter__classes">
      <legend>{t(`ind.${def.id}.filter`)}</legend>
      {def.scale.values.map((code) => (
        <label key={code} className="theme">
          <input
            type="checkbox"
            checked={picked.includes(code)}
            onChange={(event) => onChange(event.target.checked ? [...picked, code] : picked.filter((other) => other !== code))}
          />
          <span>{className(t, def, code)}</span>
        </label>
      ))}
    </fieldset>
  )
}

function FilterList() {
  const { t } = useTranslation()
  const filters = useAppStore((state) => state.filters)
  const setFilter = useAppStore((state) => state.setFilter)
  const resetFilters = useAppStore((state) => state.resetFilters)
  const showOptIn = useAppStore((state) => state.showOptIn)
  const base = useId()
  const groups = layersByGroup(visibleLayers(showOptIn).filter(isFilterable))
  const activeIn = (layers: readonly LayerDef[]) => layers.filter((def) => filters[def.id as FilterKey] !== undefined).length
  const [open, setOpen] = useState<LayerGroup | null>(() => groups.find((entry) => activeIn(entry.layers) > 0)?.group ?? null)

  return (
    <div className="filters">
      <p className="filters__intro">{t('filters.intro')}</p>
      <div className="groups">
        {groups.map(({ group, layers }) => {
          const active = activeIn(layers)
          return (
            <Group key={group} group={group} collapsible={layers.length > 1} open={open === group} onOpen={setOpen} meta={active > 0 ? <span className="badge">{active}</span> : undefined}>
              {layers.filter(isFilterable).map((def) => {
                const value = filters[def.id as FilterKey]
                const props: ControlProps = { def, value, id: `${base}-${def.id}`, onChange: (next) => setFilter(def.id as FilterKey, next) }
                return (
                  <div key={def.id} className="filter" data-active={value !== undefined}>
                    {def.filter.kind === 'classes' ? <ClassesControl {...props} /> : <SliderControl {...props} />}
                  </div>
                )
              })}
            </Group>
          )
        })}
      </div>
      <p className="filters__note">{t('filters.unknown')}</p>
      <button type="button" className="button" disabled={activeFilterCount(filters) === 0} onClick={resetFilters}>
        {t('filters.reset')}
      </button>
      <OptInSwitch />
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
