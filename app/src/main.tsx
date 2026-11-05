import '@fontsource-variable/noto-sans'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initI18n } from './i18n'
import { initialState } from './state/appStore'
import './styles/tokens.css'
import './styles/app.css'

initI18n(initialState.lang)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
