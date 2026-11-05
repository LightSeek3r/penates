import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePwaStore } from '../pwa/pwaStore'

/** Offers to load a new version instead of reloading under the visitor. */
export function UpdateNotice() {
  const { t } = useTranslation()
  const updateReady = usePwaStore((state) => state.updateReady)
  const applyUpdate = usePwaStore((state) => state.applyUpdate)
  const [dismissed, setDismissed] = useState(false)
  if (!updateReady || dismissed) return null

  return (
    <div className="toast" role="status">
      <p>{t('pwa.updateReady')}</p>
      <button type="button" className="button" onClick={() => void applyUpdate?.()}>
        {t('pwa.update')}
      </button>
      <button type="button" className="button button--quiet" onClick={() => setDismissed(true)}>
        {t('pwa.later')}
      </button>
    </div>
  )
}
