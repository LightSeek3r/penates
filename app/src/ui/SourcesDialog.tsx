import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../state/appStore'
import { PwaSection } from './PwaSection'

export function SourcesDialog() {
  const { t } = useTranslation()
  const open = useAppStore((state) => state.sourcesOpen)
  const setOpen = useAppStore((state) => state.setSourcesOpen)
  const dataThrough = useAppStore((state) => state.manifest?.dataThrough)
  const lang = useAppStore((state) => state.lang)
  const docs = lang === 'fr' ? { method: '/methodologie/', sources: '/sources/', legal: '/mentions-legales/' } : { method: '/en/methodology/', sources: '/en/sources/', legal: '/en/legal/' }
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="sources-title" onClose={() => setOpen(false)}>
      <div className="dialog__head">
        <h2 id="sources-title" className="panel__title">
          {t('sources.title')}
        </h2>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          {t('sources.close')}
        </button>
      </div>
      <p>{t('sources.method')}</p>
      <p>{t('sources.methodExtra')}</p>
      <p>{t('sources.limits')}</p>
      {dataThrough && <p>{t('sources.dataAsOf', { date: dataThrough })}</p>}
      <h3 className="legend__subtitle">{t('sources.credits')}</h3>
      <ul className="credits">
        <li>{t('sources.creditsDvf')}</li>
        <li>{t('sources.creditsIgn')}</li>
        <li>{t('sources.creditsInsee')}</li>
        <li>{t('sources.creditsGeorisques')}</li>
        <li>{t('sources.creditsOsm')}</li>
      </ul>
      <p>{t('sources.privacy')}</p>
      <h3 className="legend__subtitle">{t('sources.pages')}</h3>
      <ul className="credits">
        <li>
          <a href={docs.method}>{t('sources.methodPage')}</a>
        </li>
        <li>
          <a href={docs.sources}>{t('sources.sourcesPage')}</a>
        </li>
        <li>
          <a href={docs.legal}>{t('sources.legalPage')}</a>
        </li>
      </ul>
      <PwaSection />
    </dialog>
  )
}
