import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listingLinks } from '../domain/listings'
import { useAppStore } from '../state/appStore'

const ENDPOINT = 'https://geo.api.gouv.fr/communes'
// Arrondissements are how Paris, Lyon and Marseille sales are keyed, and /communes leaves them out by default.
const TYPES = 'commune-actuelle,arrondissement-municipal'

/** INSEE code to first postal code, kept for the session; null means the lookup found none or failed. */
const postalCodes = new Map<string, string | null>()

async function fetchPostalCode(code: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(`${ENDPOINT}?code=${encodeURIComponent(code)}&type=${TYPES}&fields=codesPostaux`, { signal })
  if (!response.ok) throw new Error(`Postal code lookup failed: ${response.status}`)
  const [item] = (await response.json()) as { codesPostaux?: string[] }[]
  return item?.codesPostaux?.[0] ?? null
}

/** Outbound searches on third-party portals for the selected commune, narrowed to the property type chosen in the price layer; absent while the postal code is unknown, or offline. */
export function ListingLinks({ code, name }: { code: string; name: string }) {
  const { t } = useTranslation()
  const base = useId()
  const type = useAppStore((state) => state.priceType)
  const [found, setFound] = useState<{ code: string; postalCode: string | null } | null>(null)

  useEffect(() => {
    if (postalCodes.has(code)) return
    const controller = new AbortController()
    fetchPostalCode(code, controller.signal)
      .then((postalCode) => {
        postalCodes.set(code, postalCode)
        setFound({ code, postalCode })
      })
      .catch(() => {
        // A network failure is not cached: the next selection tries again.
      })
    return () => controller.abort()
  }, [code])

  const postalCode = postalCodes.get(code) ?? (found?.code === code ? found.postalCode : null)
  const links = postalCode ? listingLinks({ code, name, postalCode }, type) : []
  if (links.length === 0) return null

  return (
    <div className="listings" role="group" aria-labelledby={`${base}-title`}>
      <h3 id={`${base}-title`} className="indicators__title">
        {t('listings.title')}
      </h3>
      <ul className="listings__list">
        {links.map((link) => (
          <li key={link.portal}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t(link.prefill ? 'listings.linkPrefill' : 'listings.link', { portal: link.label, name })}
            >
              {link.label}
              {link.prefill && <span aria-hidden="true"> ({t('listings.prefill')})</span>}
              <span aria-hidden="true"> ↗</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="indicators__note">
        {type !== 'all' && `${t(`listings.scope.${type}`)} `}
        {t('listings.note')}
      </p>
    </div>
  )
}
