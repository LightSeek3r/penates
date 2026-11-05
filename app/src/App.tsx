import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from './analytics/track'
import { loadManifest, tileUrl } from './data/manifest'
import { refreshOfflineStatus } from './pwa/register'
import { MapView } from './map/MapView'
import { useAppStore } from './state/appStore'
import { Inspector } from './ui/Inspector'
import { Legend } from './ui/Legend'
import { ControlPanel } from './ui/ControlPanel'
import { SourcesDialog } from './ui/SourcesDialog'
import { TopBar } from './ui/TopBar'
import { UpdateNotice } from './ui/UpdateNotice'

export default function App() {
  const { t, i18n } = useTranslation()
  const lang = useAppStore((state) => state.lang)
  const manifest = useAppStore((state) => state.manifest)
  const setManifest = useAppStore((state) => state.setManifest)
  const mapStatus = useAppStore((state) => state.mapStatus)
  const layersOpen = useAppStore((state) => state.layersOpen)
  const setMapStatus = useAppStore((state) => state.setMapStatus)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void i18n.changeLanguage(lang)
    document.documentElement.lang = lang
  }, [lang, i18n])

  useEffect(() => {
    if (manifest) void refreshOfflineStatus(tileUrl(manifest))
  }, [manifest])

  useEffect(() => {
    const controller = new AbortController()
    loadManifest(controller.signal)
      .then(setManifest)
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return
        setFailed(true)
        setMapStatus('error')
        track('map_error')
      })
    return () => controller.abort()
  }, [setManifest, setMapStatus])

  return (
    <div className="app">
      <a className="skip-link" href="#map">
        {t('skip')}
      </a>
      <TopBar />
      <main id="map" className="stage" data-layers-open={layersOpen} data-map-status={mapStatus}>
        {manifest && <MapView manifest={manifest} />}
        <div className="stage__left">
          <ControlPanel />
          <Legend />
        </div>
        <div className="stage__right">
          <Inspector />
        </div>
        {mapStatus === 'loading' && !failed && (
          <p className="status" role="status">
            {t('status.loading')}
          </p>
        )}
        {mapStatus === 'error' && (
          <p className="status status--error" role="alert">
            {t('status.error')}
          </p>
        )}
      </main>
      <SourcesDialog />
      <UpdateNotice />
    </div>
  )
}
