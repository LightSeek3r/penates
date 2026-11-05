import { useTranslation } from 'react-i18next'
import { tileUrl } from '../data/manifest'
import { promptInstall, removeMapOffline, saveMapOffline } from '../pwa/register'
import { usePwaStore } from '../pwa/pwaStore'
import { useAppStore } from '../state/appStore'
import { formatMegabytes } from './format'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

/** Install button, iOS hint and offline map control, shown in the "Sources and limits" dialog. */
export function PwaSection() {
  const { t } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const manifest = useAppStore((state) => state.manifest)
  const { installEvent, installed, offlineMap, loaded, total } = usePwaStore()
  const serviceWorker = 'serviceWorker' in navigator
  const size = manifest?.tiles.bytes ? formatMegabytes(manifest.tiles.bytes, lang) : ''

  return (
    <section className="pwa" aria-labelledby="pwa-title">
      <h3 id="pwa-title" className="legend__subtitle">
        {t('pwa.title')}
      </h3>
      {installEvent && (
        <button type="button" className="button" onClick={() => void promptInstall()}>
          {t('pwa.install')}
        </button>
      )}
      {installed && <p>{t('pwa.installed')}</p>}
      {!installEvent && !installed && isIos() && <p>{t('pwa.iosHint')}</p>}

      <h3 className="legend__subtitle">{t('pwa.offlineTitle')}</h3>
      {!serviceWorker && <p>{t('pwa.offlineUnsupported')}</p>}
      {serviceWorker && manifest && offlineMap !== 'ready' && offlineMap !== 'downloading' && (
        <button type="button" className="button" onClick={() => void saveMapOffline(tileUrl(manifest))}>
          {t('pwa.offlineSave', { size })}
        </button>
      )}
      {offlineMap === 'downloading' && (
        <p role="status">
          {t('pwa.offlineProgress', { loaded: formatMegabytes(loaded, lang), total: total ? formatMegabytes(total, lang) : '…' })}
        </p>
      )}
      {offlineMap === 'ready' && (
        <>
          <p role="status">{t('pwa.offlineReady')}</p>
          <button type="button" className="button" onClick={() => void removeMapOffline()}>
            {t('pwa.offlineRemove')}
          </button>
        </>
      )}
      {offlineMap === 'error' && <p role="alert">{t('pwa.offlineError')}</p>}
      <p className="pwa__note">{t('pwa.offlineNote')}</p>
    </section>
  )
}
