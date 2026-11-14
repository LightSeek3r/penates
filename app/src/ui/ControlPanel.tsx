import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MIXES } from '../domain/combine'
import { type FilterDef, type FilterKey, type FilterValue, activeFilterCount, isFilterable } from '../domain/filters'
import { LAYERS, type LayerDef, type LayerGroup, colourLayers, isAvailable, layersByGroup, visibleLayers } from '../domain/layers'
import { OVERLAY_GROUPS, OVERLAYS, type OverlayDef, type OverlayGroup, type OverlayId, isOverlayAvailable } from '../domain/overlays'
import { PRICE_TYPES } from '../domain/place'
import { type ThemeId, isTheme } from '../domain/themes'
import { useAppStore } from '../state/appStore'
import { className, filterValueText } from './layerText'
import { OverlaySymbol } from './OverlaySymbol'

type Tab = 'colour' | 'overlays' | 'filters'
const TABS: readonly Tab[] = ['colour', 'overlays', 'filters']
const TAB_LABELS: Record<Tab, string> = { colour: 'layers.colourTab', overlays: 'layers.overlaysTab', filters: 'layers.filtersTab' }

function Chevron() {
  return (
    <svg className="group__chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

interface GroupProps<Id extends string> {
  group: Id
  title: string
  /** Single-entry groups are always shown: collapsing one line would only cost a click. */
  collapsible: boolean
  open: boolean
  onOpen: (group: Id | null) => void
  meta?: ReactNode
  children: ReactNode
}

/** One heading per family; one tab stop (its summary) when closed, opening one closes the others. */
function Group<Id extends string>({ group, title, collapsible, open, onOpen, meta, children }: GroupProps<Id>) {
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
  const tileFields = useAppStore((state) => state.tileFields)
  const setShowOptIn = useAppStore((state) => state.setShowOptIn)
  // Nothing to opt in to while the tiles carry no opt-in layer.
  if (!LAYERS.some((def: LayerDef) => def.optIn && isAvailable(def, tileFields))) return null
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
  const showOptIn = useAppStore((state) => state.showOptIn)
  const tileFields = useAppStore((state) => state.tileFields)
  const groups = layersByGroup(colourLayers(showOptIn, tileFields))
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
            title={t(`groups.${group}.title`)}
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
            {group === 'price' && theme === 'price' && <PriceTypeControl />}
          </Group>
        ))}
      </fieldset>
      <OptInSwitch />
    </>
  )
}

/** Houses, flats or both: shown under whichever of the two indicators is price. */
function PriceTypeControl() {
  const { t } = useTranslation()
  const priceType = useAppStore((state) => state.priceType)
  const setPriceType = useAppStore((state) => state.setPriceType)
  return (
    <fieldset className="segmented">
      <legend>{t('layers.typeLabel')}</legend>
      {PRICE_TYPES.map((type) => (
        <label key={type} className="segmented__option">
          <input type="radio" name="price-type" value={type} checked={priceType === type} onChange={() => setPriceType(type)} />
          <span>{t(`layers.type.${type}`)}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Picks an indicator to show with the theme (never the theme itself) and how to draw it. */
function SecondIndicator() {
  const { t } = useTranslation()
  const theme = useAppStore((state) => state.theme)
  const compare = useAppStore((state) => state.compare)
  const setCompare = useAppStore((state) => state.setCompare)
  const mix = useAppStore((state) => state.mix)
  const setMix = useAppStore((state) => state.setMix)
  const showOptIn = useAppStore((state) => state.showOptIn)
  const tileFields = useAppStore((state) => state.tileFields)
  const groups = layersByGroup(colourLayers(showOptIn, tileFields).filter((def) => def.id !== theme))
  const base = useId()

  return (
    <section className="second" aria-label={t('second.title')}>
      <label htmlFor={`${base}-pick`} className="second__label">
        {t('second.pick')}
      </label>
      <div className="second__pick">
        <select
          id={`${base}-pick`}
          className="select"
          value={compare ?? ''}
          onChange={(event) => {
            const picked = event.target.value
            setCompare(isTheme(picked) ? picked : null)
          }}
        >
          <option value="">{t('second.none')}</option>
          {groups.map(({ group, layers }) => (
            <optgroup key={group} label={t(`groups.${group}.title`)}>
              {layers.map((def) => (
                <option key={def.id} value={def.id}>
                  {t(`ind.${def.id}.name`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {compare && (
          <button type="button" className="button button--quiet button--icon" aria-label={t('second.remove')} onClick={() => setCompare(null)}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
      {compare && (
        <>
          <fieldset className="segmented">
            <legend className="visually-hidden">{t('second.mixLabel')}</legend>
            {MIXES.map((option) => (
              <label key={option} className="segmented__option">
                <input type="radio" name="mix" value={option} checked={mix === option} onChange={() => setMix(option)} />
                <span>{t(`second.mix.${option}`)}</span>
              </label>
            ))}
          </fieldset>
          {compare === 'price' && <PriceTypeControl />}
        </>
      )}
    </section>
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
  const tileFields = useAppStore((state) => state.tileFields)
  const base = useId()
  const groups = layersByGroup(visibleLayers(showOptIn, tileFields).filter(isFilterable))
  const activeIn = (layers: readonly LayerDef[]) => layers.filter((def) => filters[def.id as FilterKey] !== undefined).length
  const [open, setOpen] = useState<LayerGroup | null>(() => groups.find((entry) => activeIn(entry.layers) > 0)?.group ?? null)

  return (
    <div className="filters">
      <p className="filters__intro">{t('filters.intro')}</p>
      <div className="groups">
        {groups.map(({ group, layers }) => {
          const active = activeIn(layers)
          return (
            <Group key={group} group={group} title={t(`groups.${group}.title`)} collapsible={layers.length > 1} open={open === group} onOpen={setOpen} meta={active > 0 ? <span className="badge">{active}</span> : undefined}>
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

function OverlayRow({ def, on, onChange }: { def: OverlayDef; on: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation()
  const about = useId()
  return (
    <div>
      <label className="theme overlay">
        <input type="checkbox" checked={on} aria-describedby={on ? about : undefined} onChange={(event) => onChange(event.target.checked)} />
        <OverlaySymbol id={def.id} />
        <span>{t(`ov.${def.id}.name`)}</span>
      </label>
      {on && (
        <p id={about} className="theme__about">
          {t(`ov.${def.id}.about`)}
        </p>
      )}
    </div>
  )
}

/** The overlay families with the overlays the loaded data can draw; families left empty are dropped. */
function useOfferedOverlays() {
  const sources = useAppStore((state) => state.overlaySources)
  return OVERLAY_GROUPS.flatMap((group) => {
    const members = OVERLAYS.filter((def) => def.group === group && isOverlayAvailable(def.id, sources))
    return members.length === 0 ? [] : [{ group, members }]
  })
}

/** Risks as lines and places as dots, drawn over whichever colour is chosen; any number can be on at once. */
function OverlayList() {
  const { t } = useTranslation()
  const overlays = useAppStore((state) => state.overlays)
  const setOverlay = useAppStore((state) => state.setOverlay)
  const on = new Set<OverlayId>(overlays)
  const groups = useOfferedOverlays()
  const activeIn = (members: readonly OverlayDef[]) => members.filter((def) => on.has(def.id)).length
  const [open, setOpen] = useState<OverlayGroup | null>(() => groups.find((entry) => activeIn(entry.members) > 0)?.group ?? null)

  if (groups.length === 0) return <p className="filters__intro">{t('overlays.none')}</p>

  return (
    <div className="filters overlays">
      <p className="filters__intro">{t('overlays.intro')}</p>
      <div className="groups">
        {groups.map(({ group, members }) => {
          const active = activeIn(members)
          return (
            <Group
              key={group}
              group={group}
              title={t(`overlays.groups.${group}`)}
              collapsible={members.length > 1}
              open={open === group}
              onOpen={setOpen}
              meta={
                active > 0 ? (
                  <span className="badge">
                    <span aria-hidden="true">{active}</span>
                    <span className="visually-hidden">{t('overlays.onCount', { count: active })}</span>
                  </span>
                ) : undefined
              }
            >
              <div className="overlay__rows">
                {members.map((def) => (
                  <OverlayRow key={def.id} def={def} on={on.has(def.id)} onChange={(next) => setOverlay(def.id, next)} />
                ))}
              </div>
              <p className="overlay__note">{t(group === 'risk' ? 'overlays.notes.risk' : 'overlays.notes.places')}</p>
            </Group>
          )
        })}
      </div>
    </div>
  )
}

/** Stays under the scrolling list, like the second indicator, so it is in reach whatever family is open. */
function ClearOverlays() {
  const { t } = useTranslation()
  const count = useAppStore((state) => state.overlays.length)
  const clearOverlays = useAppStore((state) => state.clearOverlays)
  const offered = useOfferedOverlays()
  if (offered.length === 0) return null
  return (
    <div className="overlay__foot">
      <button type="button" className="button" disabled={count === 0} onClick={clearOverlays}>
        {t('overlays.clear')}
      </button>
    </div>
  )
}

export function ControlPanel() {
  const { t } = useTranslation()
  const open = useAppStore((state) => state.layersOpen)
  const setOpen = useAppStore((state) => state.setLayersOpen)
  const count = activeFilterCount(useAppStore((state) => state.filters))
  const overlayCount = useAppStore((state) => state.overlays.length)
  const [tab, setTab] = useState<Tab>('colour')
  const badges: Record<Tab, number> = { colour: 0, overlays: overlayCount, filters: count }
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
              {t(TAB_LABELS[id])}
              {badges[id] > 0 && <span className="badge">{badges[id]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="button button--quiet layers__close" onClick={() => setOpen(false)}>
          {t('layers.close')}
        </button>
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className="controls__panel">
        <div className="controls__body">
          {tab === 'colour' && <ThemeList />}
          {tab === 'overlays' && <OverlayList />}
          {tab === 'filters' && <FilterList />}
        </div>
        {tab === 'colour' && <SecondIndicator />}
        {tab === 'overlays' && <ClearOverlays />}
      </div>
    </section>
  )
}
