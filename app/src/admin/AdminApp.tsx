import { useEffect, useState } from 'react'
import { BarList, DailyBars, VitalBar } from './charts'
import { formatCount } from './format'
import type { AdminResponse } from './types'

const RANGES = [7, 30, 90] as const
const VITAL_LABELS: Record<string, string> = {
  vitals_lcp: 'Affichage du contenu principal (LCP)',
  vitals_inp: 'Réactivité aux interactions (INP)',
  vitals_cls: 'Stabilité visuelle (CLS)',
  vitals_fcp: 'Premier affichage (FCP)',
}
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} Mo`

type Load = { status: 'loading' } | { status: 'denied' } | { status: 'error'; message: string } | { status: 'ready'; data: AdminResponse }

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>{formatCount(value)}</dd>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function AdminApp() {
  // A new `nonce` re-asks the server for the same range ("Actualiser").
  const [request, setRequest] = useState({ days: 30 as (typeof RANGES)[number], nonce: 0 })
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const settle = (next: Load) => {
      if (!cancelled) setLoad(next)
    }
    fetch(`/api/admin/stats?days=${request.days}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return settle({ status: 'denied' })
        if (!response.ok) return settle({ status: 'error', message: `Le serveur a répondu ${response.status}.` })
        settle({ status: 'ready', data: (await response.json()) as AdminResponse })
      })
      .catch((error: Error) => settle({ status: 'error', message: error.message }))
    return () => {
      cancelled = true
    }
  }, [request])

  const ask = (days: (typeof RANGES)[number], nonce = request.nonce) => {
    setLoad({ status: 'loading' })
    setRequest({ days, nonce })
  }
  const days = request.days

  return (
    <div className="admin">
      <header className="admin__bar">
        <h1>Statistiques</h1>
        <div role="group" aria-label="Période" className="range">
          {RANGES.map((range) => (
            <button key={range} type="button" aria-pressed={days === range} onClick={() => ask(range)}>
              {range} jours
            </button>
          ))}
        </div>
        <button type="button" className="refresh" onClick={() => ask(days, request.nonce + 1)}>
          Actualiser
        </button>
        <a className="back" href="/">
          Retour à la carte
        </a>
      </header>

      <main>
        {load.status === 'loading' && <p role="status">Chargement…</p>}
        {load.status === 'denied' && (
          <p role="alert" className="notice">
            Accès refusé. Cette page est réservée à l'éditeur, derrière Cloudflare Access. Vérifiez que l'application Access protège bien /admin et /api/admin, et que ACCESS_TEAM_DOMAIN et ACCESS_AUD sont définis.
          </p>
        )}
        {load.status === 'error' && (
          <p role="alert" className="notice">
            Impossible de charger les statistiques : {load.message}
          </p>
        )}
        {load.status === 'ready' && <Dashboard data={load.data} />}
      </main>
    </div>
  )
}

function Dashboard({ data }: { data: AdminResponse }) {
  const { stats, edge } = data
  const empty = 'Aucune donnée pour l’instant.'
  return (
    <>
      {!data.configured && (
        <p role="alert" className="notice">
          La base D1 n'est pas reliée au projet Pages (variable DB). Aucun compteur n'est enregistré tant qu'elle n'est pas configurée.
        </p>
      )}
      <p className="muted">
        Compteurs anonymes (totaux par jour, sans identifiant) sur {data.days} jours · mis à jour {new Date(data.generatedAt).toLocaleString('fr-FR')}
        {data.user ? ` · connecté : ${data.user}` : ''}
      </p>

      <dl className="kpis">
        <Kpi label="Pages vues" value={stats.totals.pageviews} />
        <Kpi label="Communes sélectionnées" value={stats.totals.selections} />
        <Kpi label="Recherches" value={stats.totals.searches} />
        <Kpi label="Installations" value={stats.totals.installs} />
        <Kpi label="Cartes enregistrées hors ligne" value={stats.totals.offlineSaves} />
        <Kpi label="Erreurs de carte" value={stats.totals.mapErrors} />
      </dl>

      <div className="grid">
        <Card title="Pages vues par jour">
          <DailyBars days={stats.days} values={stats.series.pageviews} label="Pages vues par jour" />
        </Card>
        <Card title="Communes sélectionnées par jour">
          <DailyBars days={stats.days} values={stats.series.selections} label="Communes sélectionnées par jour" />
        </Card>
        <Card title="Thèmes de couleur utilisés">
          <BarList items={stats.breakdown.theme} empty={empty} />
        </Card>
        <Card title="Filtres activés">
          <BarList items={stats.breakdown.filter} empty={empty} />
        </Card>
        <Card title="Appareils">
          <BarList items={stats.breakdown.device} empty={empty} />
        </Card>
        <Card title="Langues">
          <BarList items={stats.breakdown.lang} empty={empty} />
        </Card>
        <Card title="Pays">
          <BarList items={stats.breakdown.country} empty={empty} />
        </Card>
        <Card title="Provenance">
          <BarList items={stats.breakdown.source} empty={empty} />
        </Card>
      </div>

      <Card title="Vitesse de chargement ressentie">
        <table className="vitals">
          <thead>
            <tr>
              <th scope="col">Mesure</th>
              <th scope="col">Téléphone</th>
              <th scope="col">Ordinateur</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.vitals).map(([metric, split]) => (
              <tr key={metric}>
                <th scope="row">{VITAL_LABELS[metric] ?? metric}</th>
                <td>
                  <VitalBar split={split.phone} label={`${VITAL_LABELS[metric]} sur téléphone`} />
                </td>
                <td>
                  <VitalBar split={split.desktop} label={`${VITAL_LABELS[metric]} sur ordinateur`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Part des chargements jugés bons (vert), à améliorer (ambre) ou mauvais (rouge) selon les seuils de Google.</p>
      </Card>

      <Card title="Trafic vu par Cloudflare (toutes requêtes, robots compris)">
        {edge.available ? (
          <>
            <DailyBars days={edge.stats.days.map((day) => day.date)} values={edge.stats.days.map((day) => day.requests)} label="Requêtes par jour" />
            <p className="muted">
              Données transférées : {megabytes(edge.stats.days.reduce((sum, day) => sum + day.bytes, 0))} · succès {formatCount(edge.stats.status['2xx'])} · redirections {formatCount(edge.stats.status['3xx'])} · erreurs client{' '}
              {formatCount(edge.stats.status['4xx'])} · erreurs serveur {formatCount(edge.stats.status['5xx'])} · servi depuis le cache {formatCount(edge.stats.cache.hit)} de {formatCount(edge.stats.cache.hit + edge.stats.cache.other)}
            </p>
          </>
        ) : (
          <p className="muted">Non disponible : {edge.reason} Définissez CF_ANALYTICS_TOKEN et CF_ZONE_ID dans les variables du projet Pages pour l'activer.</p>
        )}
      </Card>
    </>
  )
}
