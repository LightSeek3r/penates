import '@fontsource-variable/noto-sans'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { startFlushing, trackPageview, trackVitals } from './analytics/track'
import { startUsageTracking } from './analytics/usage'
import { initI18n } from './i18n'
import { startPwa } from './pwa/register'
import { initialState, useAppStore } from './state/appStore'
import './styles/tokens.css'
import './styles/app.css'

// Resolves once the map has loaded or failed, whichever comes first.
function mapSettled(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.mapStatus === 'loading') return
      unsubscribe()
      resolve()
    })
  })
}

initI18n(initialState.lang)
startPwa(mapSettled())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

startFlushing()
trackPageview(initialState.lang)
startUsageTracking(useAppStore)
addEventListener('load', () => void trackVitals())
