import { useTranslation } from 'react-i18next'
import { useAppStore } from '../state/appStore'
import { Search } from './Search'

export function TopBar() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const setLang = useAppStore((state) => state.setLang)
  const layersOpen = useAppStore((state) => state.layersOpen)
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
      <nav className="topbar__actions" aria-label="settling-map">
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
        <button type="button" className="button" lang={lang === 'fr' ? 'en' : 'fr'} onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}>
          {t('lang.switch')}
        </button>
      </nav>
    </header>
  )
}
