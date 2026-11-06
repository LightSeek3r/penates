import { useTranslation } from 'react-i18next'
import type { LayerGroup } from '../domain/layers'

export type CreditGroup = LayerGroup | 'basemap'

/**
 * Credit lines of the Sources dialog, grouped in the order of the theme list so the list stays scannable on a phone.
 * Each group is translated as `sources.creditGroups.<group>`, each line as `sources.credit.<line>`; every line carries the
 * attribution wording its licence requires (docs/data-licences.md).
 */
export const CREDITS = [
  { group: 'price', lines: ['dvf', 'ign'] },
  { group: 'risk', lines: ['seismic', 'gaspar', 'brgm', 'asnr'] },
  { group: 'relief', lines: ['rgeAlti'] },
  { group: 'climate', lines: ['meteoFrance'] },
  { group: 'services', lines: ['insee'] },
  { group: 'connectivity', lines: ['arcep'] },
  { group: 'costs', lines: ['anil', 'dgfip'] },
  { group: 'safety', lines: ['ssmsi'] },
  { group: 'basemap', lines: ['osm'] },
] as const satisfies ReadonlyArray<{ group: CreditGroup; lines: readonly string[] }>

export function SourceCredits() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="credits-title">
      <h3 id="credits-title" className="legend__subtitle">
        {t('sources.credits')}
      </h3>
      <dl className="credits">
        {CREDITS.map(({ group, lines }) => (
          <div key={group}>
            <dt className="indicators__title">{t(`sources.creditGroups.${group}`)}</dt>
            {lines.map((line) => (
              <dd key={line}>{t(`sources.credit.${line}`)}</dd>
            ))}
          </div>
        ))}
      </dl>
    </section>
  )
}
