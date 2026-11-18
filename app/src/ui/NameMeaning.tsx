import { useTranslation } from 'react-i18next'

/** What the name means and how to say it: most visitors have never met the word. */
export function NameMeaning() {
  const { t } = useTranslation()
  return (
    <p className="name-meaning">
      <strong lang="fr">{t('app.title')}</strong>{' '}
      <span lang="fr-fonipa" className="name-meaning__ipa">
        {t('app.pronunciation')}
      </span>{' '}
      {t('app.meaning')}
    </p>
  )
}
