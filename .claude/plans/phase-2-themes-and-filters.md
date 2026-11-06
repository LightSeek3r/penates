# Phase 2: themes and filters (risks, altitude, climate, proximity)

Status: SLICE 1 DONE 2026-11-05 (live). Later slices pending. Parent: `settling-map-v1.md`. Decisions by the user (2026-11-05):
- Layer model: ONE colour theme at a time + a Filters panel that dims communes failing the criteria (the search idea inside Explore).
- Order: alternate in slices so each reaches the live site fast.

## Interface model

- **Theme** (radio): what colours the map. Price (exists), Seismic zone, Distance to nearest hospital / GP / school / supermarket / bakery / pool, later flood, clay, altitude, sunshine, heat days.
- **Filters** (panel): independent of the theme. Sliders and toggles on commune-level properties: price range, max seismic zone, max distance per amenity, later flood-free, min sunshine. Communes failing any active filter are dimmed (GPU filter, no re-fetch). A counter shows how many communes still match.
- Legend follows the theme; the reliability textures only apply to the price theme.
- The details panel lists every available indicator for the selected commune, not only the theme.
- Filters and theme live in the shareable URL.

## Tile contract additions (communes layer only)

| Property | Meaning | Unit |
|---|---|---|
| `sz` | seismic zone, 1 (very low) to 5 (strong) | integer |
| `d_hos` | straight line to nearest hospital (short-stay health establishment) | metres, rounded to 100 |
| `d_gp` | nearest general practitioner | metres |
| `d_sch` | nearest primary school | metres |
| `d_sup` | nearest supermarket or hypermarket | metres |
| `d_bak` | nearest bakery | metres |
| `d_pool` | nearest public swimming pool | metres |

Distances are measured from a representative point of the commune, to the nearest equipment of any commune; they are not travel times. Travel times come later via IGN routing for a chosen address.
Because filters must work at the national view, the `communes` layer needs to start at a lower zoom than 6 (target z5); size to be measured and reported.

## Slice 1 (this slice)

1. Pipeline: seismic zone per commune (Géorisques) and the six proximity distances from the INSEE equipment base (BPE 2025). Plausibility gate extended. Source and equipment codes verified, not assumed.
2. App: theme selector, Filters panel with sliders, dimming, per-theme legends, details list of indicators, URL state, FR/EN.
3. Docs: methodology section per indicator, licence registry rows.
4. Verify: pytest, vitest, local e2e on production build, CI data build + gate, live smoke + prod e2e.

## Slice 1 result

- Pipeline: seismic zone via Georisques API (1,840 calls) and six distances from INSEE BPE 2025 (approximate positions kept, only missing coordinates skipped); communes tiled from z4 (largest tile 1.85 MB gzip, archive 28.2 MB). CI data build and gate passed on the official DVF.
- App: Colour and Filters tabs, per-theme legends, dimming, indicators in the details panel, theme and filters in the shareable link.
- Verification: 66 pytest, 68 vitest, 42 Playwright (desktop and phone, production build with CSP), live smoke + 42 prod e2e, Lighthouse a11y 100 / best-practices 93 / SEO 92 (map pages performance 59-63, documentation pages 99-100).
- Known: Blois hospital distance 3.8 km is large because the measurement point is one point per commune. Map-page performance is the next thing to improve (heavy WebGL start, 1.4 MB main chunk).

## Later slices

Flood (TRI) share of commune, clay shrink-swell, radon, cavities; altitude (IGN altimetry API at commune points); sunshine and heat days from Météo-France stations (interpolated, disclosed); TRACC warming note; more amenities (collèges, lycées, pharmacies, dentists from BPE); fibre; crime as opt-in last. Search mode proper (budget to affordable surface) after the filters exist.

## Risks

- BPE equipment codes and coordinate columns are unverified until the agent reads the file.
- Local proxy blocks some downloads; heavy builds run in CI. Local runs use `--bpe-file` style fallbacks.
- Commune-level straight-line distance hides intra-commune variation (large rural communes): stated in the UI.
- z5 commune tiles may be large; measure before committing.

## Slice 2 plan (started 2026-11-06): everything that remains

Approved by the user ("go for all the remaining"). Delivered as two parallel tracks on one contract, then Search mode, address report and shading.

### Track A: data layers (pipeline)

`pipeline/settling/layers/` is a plug-in package (`Layer`, `LayerContext`, `LayerResult`, `discover`, `check_properties`). One module per topic defines `LAYER`; the build merges the returned properties by INSEE code, records provenance in `manifest.json` under `sources.layers`, adds the fields to the PMTiles metadata, and the gate (`check_tiles.py`) applies each layer's `ranges`, `min_coverage` and `gate`. Local run: `python -m settling.build --dep 69 --layer NAME --layer-file NAME=path`. A layer module owns its tests (`tests/test_layers_<name>.py`) and never edits shared files. Missing = absent, never 0.

| Layer module | Tile properties (communes layer) | Source (to verify) |
|---|---|---|
| `georisques` | `fl` flood class 0-3, `cl` clay shrink-swell class 0-3, `rn` radon class 1-3, `cv` known underground cavities (count) | Géorisques / BRGM / IRSN open data |
| `altitude` | `alt` metres (representative point), `rel` relief within the commune in metres | IGN altimetry (RGE ALTI) or open commune table |
| `climate` | `sun` sunshine hours/year (rounded to 10), `hot` days >= 30 C per year, `h50` hot days around 2050 under TRACC, `cd` km to nearest contributing station | Météo-France normals 1991-2020, DRIAS/TRACC |
| `amenities2` (extends `proximity.AMENITIES`) | `d_col` collège, `d_lyc` lycée, `d_pha` pharmacy, `d_den` dentist, `d_cre` crèche, `d_pos` post office, `d_gar` train station | INSEE BPE (already read) / SNCF open data |
| `fibre` | `fb` % of premises eligible to FttH (0-100) | ARCEP "Ma connexion internet" open data |
| `crime` (opt-in in the app) | `cr_v` recorded violence against persons per 1,000 residents, `cr_b` recorded home burglaries per 1,000 | SSMSI recorded offences, communal base |
| `rent_tax` | `rt` indicative rent EUR/m2 (+ `rtq` reliability 1-3), `tf` communal land-tax rate % (built property) | carte des loyers (ANIL / Ministère), DGFiP REI |

Not done in this slice, stated openly: DPE energy labels (too heavy to aggregate honestly) and individual-address data.

Tile budget: the largest national-view tile was 1.85 MB gzip. After merging, measure; if above 3 MB, trim (integer-only values, drop rarely used properties at z4-5) before publishing.

### Track B: app (data-driven layers)

`app/src/domain/layers.ts` becomes the single catalogue: for each property its theme id, i18n key, unit, break points, colour ladder family, filter kind (max/min/range/class set) and whether it is opt-in. Themes, filters, legend, inspector, URL state and tests are generated from it. New hues follow DESIGN.md (one ladder per quantity; risks warm-neutral family distinct from blue/teal/violet; crime opt-in and never in the default view).

### After A and B

1. Search mode: budget (and optional deposit/loan terms) -> affordable surface per commune from median EUR/m2 by kind, with confidence; shareable link; uses the same filters.
2. Address report: BAN geocoding -> commune indicators + nearest amenities of the address -> printable report.
3. On-demand sun shading for one address (BD TOPO buildings + terrain horizon, computed in the browser or a Worker); honest about limits.

### Verification per integration

pytest, vitest, local Playwright on the production build, CI Build data (gate) -> Deploy -> prod e2e + Lighthouse.
