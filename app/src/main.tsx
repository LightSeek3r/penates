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

initI18n(initialState.lang)
startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

startFlushing()
trackPageview(initialState.lang)
startUsageTracking(useAppStore)
addEventListener('load', () => void trackVitals())
