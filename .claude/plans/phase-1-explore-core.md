# Phase 1: Explore core

Status: DONE 2026-11-05 (live at https://settling.unit42.fr). Parent: `settling-map-v1.md`. Product truth: `PRODUCT.md`. Visual contract: `.impeccable/surfaces/explore.md` (IGN Top 25 sheet grammar in Midnight Transit palette). Tick items as done; every tick needs evidence (command + result).

## Goal

A public-ready Explore screen: France coloured by median price per m² (communes), with honest confidence (hatched thin samples, distinct no-data), search, FR/EN, mobile and desktop, deployed on `settling.unit42.fr` with tiles on `settling-tiles.unit42.fr`.

Out of scope: other layers (risks, amenities, crime, sun), Search mode, address report, IRIS grain, overseas territories, accounts.

## Layout

```
app/        Vite + React + TS (MapLibre GL, pmtiles, i18next, zustand)
pipeline/   Python (uv) + DuckDB: fetch, clean, aggregate, tile
docs/       data-licences.md (exists), methodology.md (new)
.github/workflows/  ci.yml, build-data.yml, deploy.yml
```

## Pipeline decisions

- Inputs: Admin Express COG-CARTO-PE communes (IGN, GeoParquet) and geo-DVF 5-year file. Resolve the DVF URL through the data.gouv.fr API by resource title; never hardcode the timestamped static URL. Do not use the retiring `files.data.gouv.fr/geo-dvf/latest` path.
- Cleaning (DuckDB SQL), per `id_mutation`:
  - keep `nature_mutation = 'Vente'`; drop VEFA, exchanges, adjudications;
  - keep mutations with exactly one built local of type Maison or Appartement (other mutation shapes are dropped, not guessed);
  - require `valeur_fonciere > 0`, `surface_reelle_bati >= 9`;
  - price per m² = `valeur_fonciere / surface_reelle_bati`; absolute bounds 200 to 30000 EUR/m² (deliberate: coarse guard, revisit with per-commune robust trimming if outliers survive).
- Window: last 36 months before the newest transaction date; fall back to 60 months only to raise N for sparse communes, flagged in the data.
- Aggregate per commune × type (all, maison, appartement): `n`, median, p25, p75, period start/end. Yearly medians 2021..2025 for the 5-year trend.
- Confidence: `n >= 30` high, `10-29` medium, `1-9` low (hatched), `0` insufficient. Separate state `no_coverage` for departments 57, 67, 68 and Mayotte (976): shown with its own pattern and label, never as cheap.
- Paris, Lyon, Marseille: DVF reports arrondissement codes; join to the municipal-arrondissement layer, not the 75056/69123/13055 communes. Verify against the real data before relying on this.
- Commune-code year: check which COG year DVF codes follow; add the crosswalk only if mismatches appear in the join (report unmatched count in the build log; fail the build above a threshold).
- Tiles: pure-Python tiler (shapely + mapbox-vector-tile + `pmtiles` writer) → `communes.pmtiles`. Changed from tippecanoe: tippecanoe is Linux/macOS only, no Docker/WSL here, and the DuckDB `spatial` extension download is blocked on this network (HTTP 403), so DuckDB is used for tabular work only (no extensions). One tiler runs identically locally and in CI.
  - Tile contract (the app depends on it): layer `departments` (z0-7, about 101 features) and layer `communes` (z6-10, overzoomed above). Feature id = INSEE code (`code` property, also used as `promoteId`).
  - Properties: `code`, `name`, `dep` (communes only); per type suffix `all|mai|app`: `p_<t>` median EUR/m² (int, absent if no data), `n_<t>` sales count, `c_<t>` confidence (0 insufficient, 1 low, 2 medium, 3 high, 4 no_coverage); `t2021..t2025` yearly medians for all types (communes only); `period` string.
  - Low zoom shows departments, never dropped communes (dropping sub-pixel polygons would punch holes in the choropleth). Target under 50 MB; must stay under the 512 MB CDN cache cap.
- Publish: versioned path `/v<release>/communes.pmtiles` (immutable cache) plus `manifest.json` (short cache) read by the app at start. Upload with rclone to R2 bucket `settling-map-data` (new bucket).
- Python env: `pipeline/.venv` via `python -m venv` + pip (no uv installed). Deps pinned in `pipeline/requirements.txt`.

## App decisions

- React + TypeScript + Vite. MapLibre instance lives outside React state; React renders panels only. Layer visibility via `setLayoutProperty`, no re-render on map move. Store: zustand. URL hash carries viewport, layers, selected commune (shareable links).
- i18n: react-i18next, FR default plus EN; a test fails if keys differ between locales. All legends, disclaimers and data-limit notes live in the dictionaries.
- Layer registry: one typed `LayerDef` per layer (id, group, source, style, legend, attribution, as-of date). Layer rail, legend, attribution and licence list read from it. Only layers that work are shown (no "coming soon" rows).
- Style: basemap from OpenFreeMap vector tiles, restyled to the midnight enamel palette (verify glyph/sprite endpoints at implementation). Choropleth is a step expression on the active price property; hatching is a `fill-pattern` layer for `c_* = low`, a different pattern for `no_coverage`. Ladder is monotonic in luminance (colour-blind safe); check AA contrast for text on every surface.
- Mobile: rail and inspector are bottom sheets, 44 px targets. Keyboard: search, layer list, sheets all operable; inspector is an `aria-live` region. Known gap to document: the canvas itself is not screen-reader navigable.
- Tokens as CSS custom properties; no raw hex in components. DESIGN.md is written at finish by impeccable, not before.

## Milestones (each ends with verification)

- [x] M1 Scaffold: `app/` and `pipeline/`, CI green on GitHub (lint, typecheck, unit tests, build; pipeline pytest). Evidence: CI run on b14f5c3 succeeded for both jobs.
- [x] M2 Vertical slice (Rhône) then national: map renders prices with hatching. Evidence: 33+ pytest, Playwright screenshots, 12 e2e tests on dev and production builds.
- [x] M3 National build from the OFFICIAL DVF file in CI. Evidence: live tiles pass pipeline/check_tiles.py (34,790 communes, 33,016 priced, 96 departments, Paris arrondissements 8,081-14,258, Creuse median under 1,500, 57/67/68 no-coverage), data through 2026-06-30, 20 MB. The gate also blocks publishing in build-data.yml. (Local runs used a community re-upload because the proxy blocks .gz; never published.)
- [x] M4 UI to the direction contract, plus sheet furniture (Lambert-93 grid, neatline ticks, alternating scale bar). Evidence: screenshots at 390 and 1440, 12/12 e2e on desktop and phone, independent design review (final disposition fix on two minor items: label clipping at the neatline, accepted; typeface approved by the user).
- [x] M5 Deploy: R2 bucket + custom domain + CORS + cache rule; Pages via Actions + wrangler. Evidence: smoke workflow (manifest 200, range 206, CORS and preflight, PMTiles magic, cache HIT seen) and production e2e 12/12 on https://settling.unit42.fr.
- [x] M6 Finish: detector clean, independent finish review (3 rounds), DESIGN.md + .impeccable/design.json, docs/methodology.md, licence registry matches shipped layers.

## Tests

- pytest on a small fixture CSV: VEFA excluded; multi-local excluded; outliers; median/quantiles; confidence thresholds; arrondissement join; no_coverage departments.
- Vitest: style expression builders, legend breaks, locale key parity, URL-state round trip.
- Playwright: loads at 390 and 1440, toggles price type, selects a commune via URL, switches language, keyboard path through search and rail.

## Needs from the user

1. Cloudflare API token: R2 Object Read & Write on `settling-map-data`, Pages Edit, and DNS Edit for `unit42.fr` (scoped to that zone). Create the R2 bucket `settling-map-data`. I give exact click steps at M5.
2. GitHub repo secrets (token, account id, R2 keys): add in the repo UI, or widen the PAT to allow secrets.
3. Confirm the subdomains `settling.unit42.fr` and `settling-tiles.unit42.fr` are free in your DNS records.

## Risks and checks

- Admin Express file URL and layer names are unverified; discover via the download API in M2.
- DVF code/COG-year mismatch and arrondissement handling are unverified until M2.
- MapLibre data-driven `fill-pattern` on about 35k polygons: measure frame time on a mid phone in M4; fall back to a single hatched overlay layer if slow.
- GitHub Actions free minutes (about 2000/month): data build runs on schedule twice a year plus manual dispatch, not on every push.
- DVF terms: aggregated tiles only; no per-sale data in tiles, repo or logs; no search-indexable per-sale pages.

## Approval gate

Nothing here is implemented until the user approves. Then M1 first.

## Known limits carried forward
- Place labels are cut by the neatline rather than culled (MapLibre has no viewport-aware culling); cosmetic.
- Contour relief arrives with the altitude layer (phase 2).
- Edge cache hits are not guaranteed on every request.
- E2E is not in CI by design (needs tiles); the production e2e and smoke workflows run on demand.
