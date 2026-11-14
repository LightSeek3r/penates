# Overlays rework: risks as lines, places as dots

Requested 2026-11-13: "I'm not convinced by the colour filters." Seismic zones and the other risk zones become toggleable
overlays drawn as lines; hospitals, doctors, schools, supermarkets, bakeries, pools, cinemas and other useful places
become toggleable overlays drawn as dots or icons.

Status: PLAN, not approved. Nothing implemented. Flood-polygon source still being verified (see "Open items").

## Decisions (user, 2026-11-13)

- Retired colour themes stay as Filters and in the details panel (option 1). Slices 1 and 2 start now.
- Mine, to be reported: no Co-Authored-By trailer (project rule), swimming pools are labelled "Swimming pools" because the
  source cannot tell public from private ones (fitness-club pools are in it), no `er` (emergency) kind because it sits on
  the hospital's own coordinates, risk overlays other than seismic ship first as commune-level outlines from the existing
  tiles (flood, clay, radon, cavities) so retiring their colour themes loses nothing, and polygons or points replace them in
  slice 3.

- Changed after seeing it (2026-11-13): commune outlines made a mesh (two thirds of the communes qualify for some risks), so
  flood, clay, radon and cavities are isolines like seismic: layer `risk` (lines, zooms 3 to 10) of `overlays.pmtiles`, `r` the
  risk and `z` the level the class rises to (flood and clay 1 to 3, radon 2 and 3, cavities 1, 5 and 25). The app reads them
  from the overlays archive only (`RISK_LINES`, `overlays.json` `layers.risk.lines`); the communes tiles no longer matter to
  overlays. The same pass: the open key on phones is capped at 40 % of the screen, and the picked place dot gets an amber ring.

## Archive contract (fixed 2026-11-13)

- Files at the R2 root: `overlays.json` (own manifest, so Build data never overwrites it) and `v<version>/overlays.pmtiles`.
  `overlays.json`: `{ version, tiles: { file, bytes }, sources: {...}, layers: { places: { kinds: { <id>: count } }, seismic: {...} } }`.
  The app treats a missing `overlays.json` as "no overlays available".
- Layer `places` (points), zooms 5 to 12 (the map overscales beyond): `k` kind id from `pipeline/settling/overlays/kinds.json`,
  `n` name (named kinds only, title-cased, at most 60 characters), `c` count (only when 2 or more of the kind share the
  coordinate), `a` = 1 when the position is approximate (`QUALITE_XY = M`). A dot is in the tiles from its kind's `minzoom`.
- Layer `seismic` (lines), zooms 3 to 10: `z` = 2..5, the zone the ground rises to across the line.
- Commune-level risks (flood `fl`, clay `cl`, radon `rn`, cavities `cv`) are drawn from the existing `communes` layer.

## What the code does today (verified 2026-11-13)

- One colour theme at a time, 35 radio buttons in 8 groups (`app/src/domain/layers.ts`). Seismic, flood, clay, radon,
  cavities and 13 distance-to-amenity indicators are colour themes; a Filters tab dims communes that fail.
- Tiles: one `communes.pmtiles` with `departments` and `communes` polygon layers. The tiler (`pipeline/settling/tiles.py`)
  only writes polygons (`_polygonal`). `proximity.py` states that per-equipment rows never reach the tiles; that choice is
  reversed here for places, on purpose, and must be written into the privacy and methodology text.
- Data is harvested in CI (`Build data`, April and October) and served as static files from R2. No live API at runtime.

## Interface

Panel tabs become **Colour | Overlays | Filters**.

- **Colour**: price plus the indicators that read well as a filled map (relief, climate, connectivity, costs, recorded
  crime opt-in). Radio, second indicator unchanged. Retired as colour themes: seismic, flood, clay, radon, cavities and the
  13 distance indicators. They stay available as **Filters** and in the **details panel**; their map presence moves to
  Overlays.
- **Overlays** (new): independent checkboxes in two families, each row with its own symbol swatch, so the legend is the
  list itself. Several can be on at once, on top of any colour theme. Nothing is on by default.
  - *Natural and industrial risks* (lines, never red, never amber): seismic zones, flood, clay shrink-swell, radon,
    underground cavities. Recommended additions: landslides, Seveso industrial sites, nuclear plants.
  - *Places* (dots, icons from zoom 12): health (hospitals, emergency rooms, GPs, pharmacies, dentists), education (crèches,
    nursery, primary, collège, lycée, universities and grandes écoles), daily life (supermarkets, bakeries, post offices),
    leisure and transport (public pools, cinemas, libraries, train stations).
- Legend: the active overlays get a key under the colour legend (collapsible; a count chip on phones).
- Clicking a dot opens a small card: kind, name only for public institutions, "position approximate" when the source says
  so, how many of the kind share that address.
- Links: `ov=seismic,hospital,...` in the hash. Old `th=seismic` style links keep working: a retired theme turns the
  matching overlay on and the colour back to price.

## Visual grammar (DESIGN.md amended)

- Risks are **lines**, drawn with a midnight casing under the ink so they read on every price colour. Seismic zones are
  isolines: one line where the zone rises to level 2, 3, 4; weight and dash grow with the level. Area hazards (flood, clay)
  are outlined areas with a light tint, not a texture.
- Textures keep meaning doubt and gaps on the colour layer only (Texture Carries Doubt rule unchanged). Overlays never use
  hatch, dots or cross-hatch as fills.
- Places are **dots with one shape per kind** (colour alone never carries the meaning): family hue plus a distinct pictogram
  drawn on the canvas, no new dependency. 3:1 against the dark ground, checked by a unit test like the crossed palette.
- Amber stays selection, scarlet stays errors, the blue ladder stays price.
- Dots thin by zoom: large rare kinds from zoom 6, shops and doctors from zoom 10, so the national view never turns into a
  dot cloud.

## Data

New archive `overlays.pmtiles`, separate from `communes.pmtiles`, so a refresh of places or risks never needs the heavy DVF
build. Listed in `manifest.json`; an overlay the archive lacks is hidden (the existing "hide what the tiles lack" rule).

| Overlay | Source | Geometry | Notes |
|---|---|---|---|
| Places (16 kinds) | INSEE BPE 2025, already read (2.9 M rows; about 310 k points for the kinds above) | points | Rows with `STATUT_DIFFUSION = P` (partial diffusion) are skipped; names kept only for public institutions, never for GPs, dentists, pharmacies, bakeries or shops; same kind at the same coordinate collapses to one dot with a count; `QUALITE_XY = M` flagged approximate |
| Seismic zones | Géorisques zoning per commune, already fetched | lines | Boundary of the union of communes with zone >= n, minus the coast and national border |
| Cavities | BDCavités CSV per department (reachable, 200 OK) | points | Columns to confirm |
| Clay shrink-swell | RGA 2026 shapefiles per department (reachable, CORS open) | polygons | Size is the risk: measure 3 departments first, simplify per zoom, cap the archive; fallback is the commune class `cl` |
| Flood | TRI surfaces if a bulk file exists, else GASPAR commune class `fl` | polygons or commune outline | Pending source check; labelled "TRI zones only" or "state procedures" accordingly |
| Radon | commune class `rn` already in the tiles | commune outline | No rebuild needed |
| Landslides, Seveso, nuclear | Géorisques bulk | points | Recommended, slice 3, only if a bulk file is verified |

Pipeline work: tiler learns points and lines and per-layer zoom thinning; `python -m settling.overlays` builds the archive;
`check_overlays.py` gate (counts per kind in plausible ranges, bounds, tile size cap); `build-overlays.yml` (manual, plus
twice a year); manifest and smoke workflow learn the new file; licence registry and legal text updated.

## Slices

1. **Pipeline and tiler**: points and lines in the tiler, places and seismic isolines, gate, workflow, local Rhône slice
   to look at.
2. **App**: Overlays tab, catalogue, state and URL, map layers, icons, legend, popup, FR and EN strings, retired themes
   and link redirects, tests, DESIGN.md.
3. **Area and extra risks**: cavities, clay, flood, radon outline, then landslides, Seveso, nuclear.
4. **Ship**: Build overlays, Deploy, prod e2e, Lighthouse; screenshots on desktop and a 390 px phone reviewed; independent
   finish review.

Slices 1 and 2 can start together because the archive layout (layer ids, properties) is fixed in the table above before
either starts.

## Delegation

- Sonnet: tiler points and lines with tests; the 16 pictograms and their contrast test; FR and EN strings.
- Haiku: mechanical updates of existing tests and string tables after the catalogue change.
- Opus: independent finish review of the finished UI (reads the diff, not my conclusions).
- Me: archive contract, integration, every claim from a subagent re-checked by running it.

## Verification

pytest (places, isolines, tiler points and lines, gate), vitest (catalogue, URL round trip, retired-theme redirect,
icon contrast), `pnpm lint` and typecheck, local Playwright on the production build (toggle each family, dots after zoom,
URL state, no console errors, phone viewport), CI Build overlays gate, live smoke, prod e2e, Lighthouse floors held.

## Slice 3 data facts (subagent check 2026-11-13, URLs answered 200 from this machine; sizes are its figures, to re-verify)

- Flood: bulk TRI "surfaces inondables" 2020, `files.georisques.fr/di_2020/tri_2020_sig_di.zip` (4.92 GB national, range reads
  work; river + marine, 3 scenarios about 761 MB compressed; shapefile polygons). It covers only the 115 or so TRI areas, so
  most of France has no flood polygon and 17 departments have no TRI file. The live BRGM WFS `PPRN_PERIMETRE_INOND`
  (about 77 k polygons) is wider but is not a file. Whatever is shipped must be labelled "TRI areas only", and absence is
  never shown as safe.
- Clay RGA: 95 department zips, 440 MB total, 121 k polygons, levels 1 to 3, Paris has none. Feasible in CI.
- Cavities: per-department CSV, coordinates in Lambert II étendu (inferred, the file states no EPSG), and 184 of 425 rows of
  the Rhône are confidential with no coordinates: a dot overlay would show less than half and must say so.
- Landslides (BDMvt): per-department CSV with lon/lat, about 63 k rows. Seveso and ICPE: one 43 MB CSV, 1,310 metropolitan
  Seveso sites. Nuclear installations: 85 points via BRGM WFS. All Etalab 2.0 per the site footer, not per dataset.

## Open items

- Flood polygons: choose between the TRI bulk file (covers little) and the live WFS (not a file) for slice 3.
- Clay archive size nationally; decided by a 3-department measurement before committing.
- Cavities: dots from a partial, confidential-filtered file, or keep the commune count only.
- Whether to keep the 13 distance indicators as Filters only or drop their Filters too (proposed: keep).
- Existing tests that mention retired themes: `e2e/themes.spec.ts`, `e2e/combine.spec.ts`, `e2e/phone-view.spec.ts`,
  `src/domain/layers.test.ts`, `themes.test.ts`, `combine.test.ts`, `contrast.test.ts`, `state.test.ts`, `layerText.test.ts`.
