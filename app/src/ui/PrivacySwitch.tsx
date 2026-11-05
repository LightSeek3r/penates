import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isOptedOut, setOptOut } from '../analytics/track'

/** Lets a visitor stop the anonymous counting; the choice is kept in this browser only. */
export function PrivacySwitch() {
  const { t } = useTranslation()
  const [optedOut, setOptedOut] = useState(isOptedOut)

  return (
    <section className="privacy" aria-labelledby="privacy-title">
      <h3 id="privacy-title" className="legend__subtitle">
        {t('privacy.title')}
      </h3>
      <p>{t('privacy.explain')}</p>
      <label className="theme">
        <input
          type="checkbox"
          checked={optedOut}
          onChange={(event) => {
            setOptOut(event.target.checked)
            setOptedOut(event.target.checked)
          }}
        />
        <span>{t('privacy.optOut')}</span>
      </label>
    </section>
  )
}
