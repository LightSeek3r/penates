# Phase 2: themes and filters (risks, altitude, climate, proximity)

Status: IN PROGRESS. Parent: `settling-map-v1.md`. Decisions by the user (2026-11-05):
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

## Later slices

Flood (TRI) share of commune, clay shrink-swell, radon, cavities; altitude (IGN altimetry API at commune points); sunshine and heat days from Météo-France stations (interpolated, disclosed); TRACC warming note; more amenities (collèges, lycées, pharmacies, dentists from BPE); fibre; crime as opt-in last. Search mode proper (budget to affordable surface) after the filters exist.

## Risks

- BPE equipment codes and coordinate columns are unverified until the agent reads the file.
- Local proxy blocks some downloads; heavy builds run in CI. Local runs use `--bpe-file` style fallbacks.
- Commune-level straight-line distance hides intra-commune variation (large rural communes): stated in the UI.
- z5 commune tiles may be large; measure before committing.
