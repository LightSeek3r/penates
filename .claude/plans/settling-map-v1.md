# settling-map v1 plan

Status: user answered open questions 2026-11-04 (domain unit42.fr, MIT, FR+EN, React+TS+Vite, PAT use OK for phase 0). Phase 0 bootstrap authorised; phases 1+ need check-in. No app code written. Repo: github.com/LightSeek3r/settling-map (private, flip public later).
Data research verified 2026-11-04 by 4 subagents; spot-checked by hand: Georisques v1 seismic, geopf geocoder, geopf altimetry, geo-DVF resources, SSMSI resources, npm versions (maplibre-gl 6.16.0, pmtiles 4.5.0, deck.gl 9.4.1). Everything else below is subagent claim = lead, re-verify when first used.

## Decisions (from user)
- Purpose: portfolio/open source AND free public site.
- Scope: metropolitan France first; communes + IRIS native grain; address level on demand only.
- Two modes: Explore (layer map) and Search (constraints, affordability). Shared constraint engine, two UIs. Explore ships first.
- Sun: regional sunshine hours nationally + on-demand shading for one address.
- Storage: Cloudflare free (R2, Pages, Workers) + Supabase free. Repo on GitHub private.
- Design: use impeccable skill (surface mode = Operate). Run `impeccable context` at start of UI work; PRODUCT.md + DESIGN.md first.

## Architecture
- App: static SPA on Cloudflare Pages (GitHub Pages unavailable for private free repos). Vite + TypeScript + React + MapLibre GL + PMTiles protocol. deck.gl only if GPU filtering needed (DataFilterExtension: max 4 numeric dims, float32).
- Data: build pipeline in GitHub Actions (about 2000 free min/month). Python + DuckDB (spatial) -> GeoParquet -> tippecanoe -> PMTiles. tippecanoe not native on Windows: run in CI/Docker/WSL.
- Hosting data: R2 bucket behind a CUSTOM DOMAIN (r2.dev is non-production, rate-limited). CORS: GET/HEAD, allow Range header, expose ETag/Content-Range/Content-Length. Cache Rule for .pmtiles. CDN will not cache files > 512 MB -> split archives under 512 MB (per theme or zoom band). Upload with rclone/wrangler (dashboard cap 300 MB).
- Supabase: auth + saved shortlists only (post-v1). NOT for tiles/data: 5 GB egress, 50 MB file cap, pauses after 1 week idle.
- Basemap: OpenFreeMap (no key, free) first; self-hosted Protomaps France extract on R2 later if needed. Attribution OSM/OpenMapTiles.
- Workers: PVGIS proxy (PVGIS forbids browser/AJAX calls). Free Worker: 100k req/day, 10 ms CPU.
- Isochrones/routing: IGN Geoplateforme direct from browser (isochrone 5 req/s per IP, routing 10 req/s per IP, no key). Geocoder: data.geopf.fr/geocodage (50 req/s per IP, CORS *). Old api-adresse host deprecated.
- Spatial key: commune INSEE code + IRIS code. Sources use different COG years (crime 2026, BPE/pop 2025, Filosofi grid 2021). Build one commune-code crosswalk table first; every layer joins through it.
- Skip 200 m grid in v1 (about 14M cells, covers metro + Martinique + Reunion only). Revisit.

## Verified sources (v1)
| Layer | Source | Grain | Licence | Key gotchas |
|---|---|---|---|---|
| Boundaries | IGN Admin Express 2026 (GeoParquet, data.geopf.fr), CONTOURS-IRIS-PE | commune, IRIS | LO 2.0 | PE variant generalised; cannot overlay on pre-v3 versions |
| Price EUR/m2 | geo-DVF 5-yr single file dvf.csv.gz (609 MB), data.gouv | sale -> aggregate | LO 2.0 + DGFiP CGU | No Alsace-Moselle (57/67/68), no Mayotte. One row per local, price repeated -> group by id_mutation. Drop VEFA/exchanges/adjudications. Only first 5 lots. id_mutation changes each release -> re-ingest all. Refresh Apr + Oct. Old files.data.gouv.fr/geo-dvf/latest folder dies end Nov 2026. CGU: no re-identification, not search-indexable -> aggregates only |
| Price trend | Cerema DV3F annual commune indicators API (2010-2025) | commune | LO 2.0 | beta preprod API, slow; missing = statistical secrecy |
| Rent | ANIL Carte des loyers 2025 | commune | LO 2.0 | Attribution text mandatory (ANIL, SeLoger, leboncoin). Asking rents incl. charges. Low R2 / few obs -> flag |
| Energy | ADEME DPE (dpe03existant, 15.9M rows) | address (75% geocoded) | LO 2.0 | API page cap 10k rows -> cursor. Not representative of stock. Aggregate per commune/IRIS |
| Tax | DGFiP Fiscalite locale des particuliers (taux_global_tfb) | commune, 2021-2025 | LO 2.0 | Rate only, no euro amount |
| Copro | RNIC (Anah) 412 MB CSV | point | LO 2.0 | No finances. Columns renamed Apr 2026. Post-v1 |
| Seismic | Georisques API v1 zonage_sismique (no token) | commune | LO / etalab | Verified live |
| Clay (RGA) | Georisques bulk shapefile by dept, 2026 map | polygon | LO | New 2026 edition applies to contracts from 2026-07-01. Paris excluded |
| Flood | Georisques WFS TRI hazard layers (river, runoff, marine submersion) | polygon | LO | No national AZI/PPR polygons (per-DDT only). Say "TRI zones only" |
| Groundwater, radon | Georisques WMS only (REMNAPPE, RADON) | raster/commune | LO | Radon via API v1 per commune |
| Cavities / landslides | Georisques bulk + WFS | point | LO | Cavites missing for 75,78,91-95 |
| Altitude | IGN RGE ALTI 5 m by dept (7z ASC) -> zonal stats offline; altimetry API for points | commune stats, point | LO 2.0 | Large (1 m dept archives > 4 GiB). Use 5 m. API 5 req/s/IP, verified live |
| Sunshine / heat | Meteo-France monthly station data (INST, NBJTX30/35) | station -> interpolate | LO v2 | Stations not grid. Interpolation method must be disclosed |
| Climate future | TRACC (+2 C 2030, +2.7 C 2050, +4 C 2100 mainland) | national | official | Climadiag per commune is PDF only; DRIAS download unverified -> label as national trajectory in v1 |
| Crime | SSMSI commune parquet (16 MB), July 2026 ed. | commune | LO 2.0 | Hidden if <=5 offences in any of 3 yrs (est_diffuse). 15 indicators; no homicide per commune. Opt-in layer, label "recorded", per 1,000 inhabitants (burglary per 1,000 dwellings). Check real column name (CODGEO_2025 vs 2026) |
| Hospitals | FINESS+ (ANS) daily JSON | point | LO 2.0 | Old FINESS frozen May 2026. Filter closed. Check coordinate CRS |
| GPs | DREES APL 2024 (xlsx) | commune | LO 2.0 | Method comparability unverified |
| Schools | data.education.gouv.fr annuaire + IPS + IVAL (Opendatasoft, CORS) | point | LO 2.0 | Brevet per school stops 2021 -> use college IVAL |
| Amenities | INSEE BPE 2025 parquet 164 MB | point | LO 2.0 | Some addresses anonymised |
| Population | INSEE pops ref 2023 (commune), IRIS pop Oct 2026 | commune, IRIS | LO 2.0 | Mayotte excluded. Credit "Source : Insee" + date |
| Income | Filosofi IRIS 2021 | IRIS | LO 2.0 | Old vintage |
| Fibre / mobile | ARCEP quarterly, Q2 2026 | commune | LO | Post-v1 |

Deferred (not v1): Atmo air quality (ODbL share-alike), noise (no national file), transport GTFS (500 regional feeds), Climadiag/DRIAS per commune, RNIC, wildfire/drought extras.

## Legal / ethics guardrails
- Licence registry file (docs/data-licences.md) with exact attribution per layer; shown in-app.
- Aggregated tiles only for DVF; robots rules + no per-sale indexable pages.
- Risk layers: "indicatif, non reglementaire, ne remplace pas l'ERRIAL" + link to official Georisques report for the address. Missing data shown as "no data", never "safe". (Wording is our suggestion, not an official requirement.)
- Crime: opt-in toggle, "recorded offences", grey hidden communes, no ranking/score that includes crime by default.
- Show N transactions + confidence on price; grey out thin cells.
- No secrets in repo; scan history before flip to public. pat.txt stays outside tree.

## Phases
0. Bootstrap: git init, remote, .gitignore, CI skeleton, licence registry, commune-code crosswalk. (Needs PAT -> ask first.)
1. Explore core: boundaries + DVF median EUR/m2 by commune (houses/apartments, rolling window, N) + basemap + layer toggle + legend + data-as-of. impeccable: init (PRODUCT.md), shape, DESIGN.md.
2. Risks + terrain + sunshine: seismic, RGA, TRI flood, cavities, radon, altitude stats, sunshine hours, TRACC note.
3. Amenities + connectivity: BPE, FINESS+, schools, APL, fibre. Crime opt-in last.
4. Search mode: shared constraint engine, filters, affordability inversion (budget -> reachable surface per commune), shareable URL state.
5. Address report + on-demand shading: geocode, horizon from LiDAR HD MNS (altimetry API ring), suncalc, BD TOPO buildings; PVGIS via Worker. Blocked by LiDAR HD coverage check.

## Open items (unverified)
- LiDAR HD MNT/MNS/MNH coverage as of Nov 2026; derived-model bulk download route.
- DRIAS per-commune download; Climadiag reuse terms.
- Which RGA edition the Georisques WFS serves (2020 vs 2026).
- APL indicator units and method comparability.
- FINESS+ coordinate CRS.
- cartes.gouv.fr CGU on direct browser use by public site.
- duckdb-wasm "2.0.0" mentioned in docs but not on npm (latest stable 1.32.0).

## Answers from user
1. Domain: unit42.fr. TODO confirm its DNS zone is on the Cloudflare account. Free Universal SSL covers only one subdomain level (*.unit42.fr), so use single-level names, e.g. settling.unit42.fr (app) and settling-tiles.unit42.fr (R2), not tiles.settling.unit42.fr.
2. Licence: MIT (advised: portfolio-friendly; revisit before going public if cloning-for-profit worries the owner; AGPL is the alternative).
3. UI language: FR + EN (i18n from day one).
4. Stack: React + TS + Vite. Perf note: UI framework is not the bottleneck for a map app; tile size, GPU filtering, and keeping map state out of React render are. Svelte/Solid would be marginally lighter, not decisive.
5. PAT: approved for LightSeek3r/settling-map only. Commit identity LightSeek3r, no co-author trailer, push to main.

## Approval gate
CLAUDE.md: check in before implementing. Nothing implemented until user approves this plan.
