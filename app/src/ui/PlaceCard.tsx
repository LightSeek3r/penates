import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../state/appStore'
import { formatNumber } from './format'
import { PlaceBadge } from './OverlaySymbol'

/** Escape closes the card unless another control owns the key (search list, a dialog, a field being typed in). */
function ownsEscape(card: HTMLElement | null): boolean {
  const active = document.activeElement
  if (document.querySelector('dialog[open]')) return false
  return active === null || active === document.body || card?.contains(active) === true || active.closest('.map') !== null
}

/** A dot picked on the map: its kind, its name when the source gives one, and how far its position can be trusted. */
export function PlaceCard() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const place = useAppStore((state) => state.placeSelection)
  const selectPlace = useAppStore((state) => state.selectPlace)
  const card = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // Where focus was before the card took it, so closing hands it back instead of dropping it on the page.
  const returnTo = useRef<Element | null>(null)
  const base = useId()

  const close = () => {
    const target = returnTo.current
    returnTo.current = null
    selectPlace(null)
    const back = target instanceof HTMLElement && target.isConnected && target !== document.body ? target : document.querySelector<HTMLElement>('.map canvas')
    back?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!place) return
    if (!card.current?.contains(document.activeElement)) returnTo.current = document.activeElement
    heading.current?.focus({ preventScroll: true })
  }, [place])

  useEffect(() => {
    if (!place) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !ownsEscape(card.current)) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  if (!place) return null

  const kind = t(`ov.${place.kind}.one`)
  const title = place.name ? place.name : kind

  return (
    <section ref={card} className="panel placecard" aria-labelledby={`${base}-title`}>
      <div className="panel__head">
        <div className="placecard__head">
          <PlaceBadge kind={place.kind} size={28} />
          <div>
            <h2 id={`${base}-title`} ref={heading} className="placecard__name" tabIndex={-1}>
              {title}
            </h2>
            {place.name && <p className="inspector__meta">{kind}</p>}
          </div>
        </div>
        <button type="button" className="button button--quiet button--icon" aria-label={t('card.close')} onClick={close}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
      {(place.count > 1 || place.approximate) && (
        <ul className="placecard__facts">
          {place.count > 1 && <li>{t('card.count', { count: place.count, value: formatNumber(place.count, lang) })}</li>}
          {place.approximate && <li>{t('card.approximate')}</li>}
        </ul>
      )}
      <p className="inspector__disclaimer">{t('card.source')}</p>
    </section>
  )
}
