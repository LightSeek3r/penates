import { useTranslation } from 'react-i18next'
import { pathForLang } from '../i18n'
import { usePwaStore } from '../pwa/pwaStore'
import { useAppStore } from '../state/appStore'
import { Search } from './Search'

export function TopBar() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const layersOpen = useAppStore((state) => state.layersOpen)
  const online = usePwaStore((state) => state.online)
  const setLayersOpen = useAppStore((state) => state.setLayersOpen)
  const setSourcesOpen = useAppStore((state) => state.setSourcesOpen)

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true" />
        <div>
          <p className="brand__name">{t('app.title')}</p>
          <p className="brand__tagline">{t('app.tagline')}</p>
        </div>
      </div>
      <Search />
      {!online && (
        <p className="offline-pill" role="status">
          {t('pwa.offlineBadge')}
        </p>
      )}
      <nav className="topbar__actions" aria-label="Pénates">
        <button type="button" className="button button--layers" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
          {t('layers.title')}
        </button>
        <button type="button" className="button" aria-label={t('sources.open')} onClick={() => setSourcesOpen(true)}>
          <span className="label-long" aria-hidden="true">
            {t('sources.open')}
          </span>
          <span className="label-short" aria-hidden="true">
            {t('sources.short')}
          </span>
        </button>
        <div className="lang" role="group" aria-label={t('lang.label')}>
          {(['fr', 'en'] as const).map((code) =>
            code === lang ? (
              <span key={code} className="lang__option" lang={code} aria-label={`${code.toUpperCase()}, ${t(`lang.${code}`)}`} aria-current="true">
                {code.toUpperCase()}
              </span>
            ) : (
              <a
                key={code}
                className="lang__option"
                href={pathForLang(code)}
                hrefLang={code}
                lang={code}
                aria-label={`${code.toUpperCase()}, ${t(`lang.${code}`)}`}
                onClick={(event) => {
                  event.preventDefault()
                  window.location.assign(`${pathForLang(code)}${window.location.hash}`)
                }}
              >
                {code.toUpperCase()}
              </a>
            ),
          )}
        </div>
      </nav>
    </header>
  )
}
