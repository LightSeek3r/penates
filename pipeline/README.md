# Pénates data pipeline

Builds `communes.pmtiles`: median property price per m² (DVF) by commune and by department, plus, per
commune, the seismic zone (Géorisques) and straight-line distances to six kinds of amenities (INSEE BPE),
for metropolitan France and Corsica. Pure Python: DuckDB for tabular work, shapely + mapbox-vector-tile +
pmtiles for tiles. No tippecanoe, no DuckDB extensions, no GDAL.

## Run

```sh
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install -r pipeline/requirements.txt
pipeline/.venv/Scripts/python -m pip install -e pipeline     # makes `settling` importable from the repo root

# from the repo root
pipeline/.venv/Scripts/python -m settling.build --dep 69 --out data/build/slice      # one or more departments
pipeline/.venv/Scripts/python -m settling.build --out data/build/national           # all metropole + Corsica
pipeline/.venv/Scripts/python -m pytest pipeline/tests -q                            # offline, a few seconds
```

Options: `--dep 69 01` (several departments), `--raw DIR` (download cache, default `data/raw/`),
`--dvf-file PATH` (use a local geo-DVF file, `.csv`, `.csv.gz` or `.parquet`, instead of downloading),
`--bpe-file PATH` (use a local `BPE25.parquet` instead of downloading it),
`--seismic-file PATH` (use a CSV with columns `code_insee,code_zone` instead of querying Géorisques; the
build's own cache file in `data/raw/seismic/` has that format), `--workers N` (tile encoding processes).

The build is idempotent: downloads are cached in `data/raw/` and re-used when their size matches; the
tile archive is byte-identical between runs on the same day (gzip mtime 0, sorted tiles).

Outputs in `--out`:

- `communes.pmtiles`: layers `departments` (z0-7) and `communes` (z4-10).
- `manifest.json`: version (UTC date), source dates and hashes (DVF, ADMIN EXPRESS, BPE, seismic), tile
  file name/bytes/sha256, counts (including communes with each indicator), confidence histogram.
- `build-report.json`: row counts at each cleaning step, code reconciliation, per-department values,
  spot checks, tile sizes per zoom, step timings, per-area aggregates (n, p25, median, p75, window), and
  `indicators`: seismic join methods and zone histogram, BPE equipments kept/skipped per type, distance
  quantiles per type, indicator spot checks.

No output or log of `settling.build` contains per-sale or per-equipment data (the places archive below is built apart,
on purpose, and has its own rules). The cleaned sales exist only inside the in-memory DuckDB connection (spill files,
if any, go to `data/raw/duckdb-tmp/`).

## Sources

| Source | How it is resolved |
|---|---|
| geo-DVF, 5-year single file (DGFiP / Etalab) | data.gouv.fr API, dataset `demandes-de-valeurs-foncieres-geolocalisees`, the one `csv.gz` resource whose title contains "fichier unique". Size and published sha1 are verified. The timestamped static URL is never hardcoded; `files.data.gouv.fr/geo-dvf/latest` is not used. |
| IGN ADMIN EXPRESS COG-CARTO-PE | Géoplateforme download API, `https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG-CARTO-PE`. The newest edition matching `*__GEOPARQUET_WGS84G_FRA_<date>` is picked (verified: `ADMIN-EXPRESS-COG-CARTO-PE_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01`). Layers used: `commune.parquet`, `arrondissement_municipal.parquet`, `departement.parquet`, `commune_associee_ou_deleguee.parquet` (GeoParquet 1.1, WKB column `geometrie`, EPSG:4326). |

| INSEE Base permanente des équipements 2025, geolocated detail file | Stable URL `https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet`, linked from `https://www.insee.fr/fr/statistiques/8217525`. INSEE refreshes the file monthly under the same URL; the page's "Paru le" date is scraped into the manifest (`page_release_date`, `null` if the page layout changes) with the file sha256. A new BPE edition has a new page id, so moving to it is a code change. |
| Géorisques seismic zoning (décret 2010-1255) | API v1 `https://www.georisques.gouv.fr/api/v1/zonage_sismique?code_insee=...`, 20 codes per request (the API maximum), about 1,840 requests nationally (~2 min). Cached per day and code set in `data/raw/seismic/`. No bulk file exists: data.gouv.fr only has per-department or third-party copies, the GASPAR bulk zip has no zone, and the Géorisques WFS layer `ms:risq_zonage_sismique` has zone polygons without commune codes. |

Attribution in the tiles: `© IGN, DGFiP/Etalab, INSEE, Géorisques (Licence Ouverte v2.0)`.

### Network notes

- TLS goes through the OS trust store (`truststore`), so TLS-inspecting proxies work without disabling
  verification.
- On the development network a Zscaler policy rejects `*.gz` downloads ("not allowed to access this
  file type", HTTP 403 HTML page). The build then stops with a `SourceError` telling you to fetch the
  file by other means and pass `--dvf-file`. It does not try to work around the proxy.

## Cleaning rules (`settling/clean.py`)

All rules apply per `id_mutation` (one deed). DVF repeats `valeur_fonciere` on every row of a deed, so
rows are grouped before any price is used.

1. `nature_mutation = 'Vente'`. Drops VEFA, Echange, Adjudication, Expropriation, Vente terrain à bâtir.
2. Exactly one distinct habitation local (`type_local` Maison or Appartement). geo-DVF repeats a local
   once per `nature_culture` of its parcel (for example "sols" and "jardins"), so a local is identified by
   `(id_parcelle, type_local, surface_reelle_bati, nombre_pieces_principales, lot1_numero)`, not by row.
   Counting rows instead would drop about 413k single-house deeds nationally (most of them houses with
   gardens). Deeds with two or more distinct habitation locals are dropped, not split.
3. Any `Local industriel. commercial ou assimilé` row disqualifies the deed, because its value is in the
   price.
4. `Dépendance` rows (cellars, parking spaces) and land-only rows are ignored. They come with most flat
   and house sales and the deed price cannot be split. Known bias: the price per m² of a flat sold with a
   parking space is slightly overstated.
5. One distinct `valeur_fonciere`, `> 0`; `surface_reelle_bati >= 9`.
6. `price_m2 = valeur_fonciere / surface_reelle_bati` within 200..30000 EUR/m². `# deliberate:` a coarse
   absolute guard. Revisit with per-commune robust trimming if outliers survive.

Windows: the primary window is 36 months ending at the newest transaction date in the input. For an
area with fewer than 10 sales in 36 months, the 60-month window is used **for all three types of that
area** if it has more sales (`w = 60`). `w` is one value per feature, so the decision is made on type
`all`.

Aggregates per area x type (`all`, `mai`, `app`): n, median, p25, p75 (DuckDB `quantile_cont`, linear
interpolation), plus the window start and end. Yearly medians `t2021..t2025` (type `all`, calendar year,
communes only). Confidence `c_*`: n ≥ 30 → 3, 10-29 → 2, 1-9 → 1, 0 → 0. Departments 57, 67, 68 and
communes `976*` → 4 (no_coverage), with no price or count at all.

### Commune codes

- Paris, Lyon and Marseille: DVF uses municipal-arrondissement codes only (75101-75120, 69381-69389,
  13201-13216; verified, no 75056/69123/13055 rows). The parent communes are replaced by the 45
  `arrondissement_municipal` geometries.
- COG year: geo-DVF codes follow an older COG than the 2026 boundaries (for example Pierrefitte-sur-Seine
  93059, merged into Saint-Denis on 2025-01-01, still appears). Unmatched codes are mapped first by the
  ADMIN EXPRESS `commune_associee_ou_deleguee` table (old code → commune de rattachement), then by the
  boundary commune that contains the median location of that code's sales (mergers without communes
  déléguées). The report lists every mapping. The build fails if the remaining unmatched sales exceed 0.5%
  of retained sales.

## Seismic zone (`settling/seismic.py`)

`sz` is the regulatory zone 1 (very low) to 5 (strong); metropolitan France has zones 1-4. A tile commune
gets, in order: the API zone of its own code (34,751 nationally); for a municipal arrondissement, its
parent's (Lyon 69123 and Marseille 13055; the API answers Paris by arrondissement, not 75056) (25); for a
merged commune absent from the API, the highest zone among its communes déléguées (0 in 2026); otherwise
the highest zone of the communes it touches, or the nearest commune for an island (12: eleven communes
the API does not know, which have no déléguée entry, and Ouessant 29155). The report lists every
fallback with the neighbours' zones.

## Distances (`settling/proximity.py`)

`d_*` is the straight-line distance in metres, rounded half up to 100 m, from a point inside the commune
polygon (shapely `point_on_surface`, `# deliberate:` not the town centre) to the nearest equipment of the
type anywhere in metropolitan France and Corsica (Lambert-93, scipy `cKDTree`). Border communes do not
see equipments abroad. BPE `TYPEQU` codes, verified in `TYPEQU_2025.csv`:

| Property | Codes |
|---|---|
| `d_hos` | D101 établissement de soins de courte durée (excludes autonomous maternity units D107 and emergency services D106) |
| `d_gp` | D265 médecin généraliste |
| `d_sch` | C108 école primaire, C109 école élémentaire (every school with an elementary class; C107 maternelle-only excluded) |
| `d_sup` | B105 supermarché et magasin multi-commerce (400-2500 m²), B104 hypermarché et grand magasin (≥ 2500 m²) |
| `d_bak` | B207 boulangerie-pâtisserie |
| `d_pool` | F101 bassin de natation |

Rows are used when `EPSG = 2154` and `LAMBERT_X/Y` are present and inside metropolitan France.
`QUALITE_XY = M` (mauvaise: probable street, or a random point ≥ 500 m off) is kept and counted
(`kept_approximate`): the point is still in the right commune, while skipping these rows removed whole
hospitals (CH Calvi, CH Dax, CH Blois) and lengthened 185 communes' hospital distance by more than 5 km.
Only rows without usable coordinates are skipped.
`QUALITE_XY = _U` (undetermined) is kept: all bassins de natation come from Data ES, not from address
geocoding, so INSEE gives them no quality flag.

## Tiles (`settling/tiles.py`)

Contract (the app depends on it):

- `departments` z0-7: `code`, `name`, `p_*`, `n_*`, `c_*`, `w`, `period`.
- `communes` z4-10 (overzoomed above): `code`, `name`, `dep`, `p_*`, `n_*`, `c_*`, `t2021..t2025`, `w`, `period`,
  `sz`, `d_hos`, `d_gp`, `d_sch`, `d_sup`, `d_bak`, `d_pool`.
- `*` is `all`, `mai` or `app`. Integers only, except `code`, `name`, `dep`, `period` (`YYYY-MM/YYYY-MM`).
  Missing values are omitted.
- The MVT feature id is the numeric INSEE code, with 2A/2B → 201/202 (MVT ids must be unsigned integers).
  The app should use `promoteId: "code"` and ignore the numeric id.

Method: Web Mercator. Each zoom gets one Douglas-Peucker pass (`preserve_topology`) with a tolerance of
1 tile unit at extent 4096 (1/8 px on a 512 px tile). Each tile then gets: clip with a 64-unit buffer,
snap to the integer grid (`set_precision`), MVT encode, gzip. Empty tiles are not written. Tiles are
encoded in a process pool. Neighbouring polygons are simplified independently, so shared borders can
differ by up to 1 unit. `# deliberate:` this is invisible at that size and avoids a topology library.
Communes use 4 units (0.5 px) at z4 and z5. A polygon that snapping erases (smaller than one unit) is
replaced by a 1-unit square at its inner point, in the one tile that contains that point, so every
commune exists at every zoom (the plausibility gate checks z4 against z8).

The tiler also writes points and lines (the overlays archive): points are clipped to the tile and its buffer, lines
are clipped the same way and simplified per zoom by the same tolerances (`simplify_units`), and a feature can carry its
own `minzoom`, so it is only in the tiles of that zoom and above. A line that snapping collapses to a point is dropped.
A point never moves except onto the integer grid, and two points can share a unit.

## Overlays archive (`settling/overlays`)

`overlays.pmtiles` holds what the map draws on top of the colour theme, built apart from `communes.pmtiles` with its
own manifest (`overlays.json`) and workflow (`build-overlays.yml`), so a refresh of the places or of the zoning never
needs the DVF build. It never writes `communes.pmtiles` or `manifest.json`.

- Layer `places` (z5-12, points): one dot per kind and exact position. Properties: `k` kind id (the ids, families, BPE
  codes and first zoom of each kind are in `settling/overlays/kinds.json`, the contract with the app), `n` name (named
  kinds only, title case, at most 60 characters), `c` rows of the kind at that position (only when 2 or more), `a` = 1
  when the position is approximate (`QUALITE_XY = M`). A dot is in the tiles from its kind's `minzoom`.
- Layer `seismic` (z3-10, lines): `z` = 2..5. For each zone level present in the data, the boundary of the union of
  the communes in that zone or above, minus the stretches that follow the outline of the zoned communes (coast, border).
  That is the commune boundaries where the zone rises, not the national outline: it is cut away with a negative buffer
  of the union of all zoned communes in Lambert-93 (30 m), so lines stop 30 m short of the coast and no exact vertex
  match is needed. A zone that jumps two levels has a line at each level. Lines are cut into parts of about 25 km, since
  a tile feature is copied into every tile its bounding box touches, and simplified hard at low zooms.
- Layer `risk` (z3-10, lines): `r` = the overlay id (`flood`, `clay`, `radon`, `cavities`) and `z` = the level, an
  integer: the line marks where the class rises to at least `z`, exactly like the seismic lines. The levels are in one
  table, `RISKS` in `settling/overlays/risk_lines.py`, which mirrors `RISK_LINES` in `app/src/domain/overlays.ts` (a
  pytest reads that file and compares ids, properties and levels): flood `fl` 1, 2, 3; clay `cl` 1, 2, 3; radon `rn`
  2, 3 (class 1 is "low potential" and covers most of the Massif central and Brittany); cavities `cv` 1, 5, 25 (counts).
  The geometry is the Admin Express boundaries, the values are read from a communes archive (below). Same method and
  simplification as `seismic` (`settling/overlays/isolines.py` is the one function behind both). A level gets lines
  when some commune has a value from that level up to the next one, so a level that would repeat the line of the next
  level is left out (cavities: if no commune has between 1 and 4 cavities, there is no level 1).

The risk lines are cut from commune classes, not from the Géorisques files: they come from the `communes` layer of a
`communes.pmtiles` (properties `fl`, `cl`, `rn`, `cv`; `settling.build` computes them). The reader
(`settling/overlays/commune_classes.py`) decodes the lowest zoom of that layer (z4: the tiler writes every commune at
every zoom, checked on `national-p2`, 34,788 communes at z4 and at z5, 6, 7, 8 and 10 alike), keys communes by their
`code` (Paris, Lyon and Marseille are their 45 municipal arrondissements in both the tiles and the boundaries, so the
join is by code with no special case), merges a commune cut by a tile border (identical values, else an error) and turns
a whole number the tile stored as a float into an integer.

Honesty rule: a commune without the property has no value and is never read as class 0. Its ground is unknown, so
every stretch of boundary that touches it is dropped, the way the coast is: the "known" ground is the union of the
communes that have a value for that property, shrunk by 30 m, and only the parts of the lines inside it are kept. A
line therefore never implies "lower class" across ground nobody measured, and it ends 30 m short of an unknown commune.
Known gaps in the classes: `cv` is absent for the Lyon arrondissements and for the departments Géorisques does not
publish (75, 78, 91 to 95), `cl` for Paris. `overlays-report.json` lists, per overlay id, how many communes of the
boundaries have no value (with their departments and 20 codes) and how many communes of the archive have no boundary.

```sh
pipeline/.venv/Scripts/python -m settling.overlays --out data/build/overlays-national --communes-file communes.pmtiles
pipeline/.venv/Scripts/python -m settling.overlays --dep 69 23 --out data/build/slice-p3 --bpe-file data/raw/bpe/BPE25.parquet --communes-file data/build/slice-p3/communes.pmtiles
pipeline/.venv/Scripts/python pipeline/check_overlays.py data/build/overlays-national/overlays.pmtiles   # --slice for a department
```

Options: `--dep` (department codes; the isolines of a slice leave out the border with the next department, which is
outline there), `--raw DIR`, `--bpe-file PATH`, `--seismic-file PATH` (CSV `code_insee,code_zone`), `--communes-file PATH`
(a local `communes.pmtiles`) or `--communes-url URL` (downloaded to `raw/communes/` with the retrying, resuming
downloader; the cache name comes from the URL; one or the other), `--only places|seismic|risk` (repeatable; the archive
then holds those layers only), `--workers N`. Without `--communes-file` or `--communes-url` the `risk` layer is skipped
with a log line and places and seismic still build; `--only risk` without one stops with a message. Outputs in `--out`:
`overlays.pmtiles`, `overlays.json` (`version`, `sources` with sha256 and editions of the BPE, the seismic zoning,
ADMIN EXPRESS and the communes archive (file or URL, bytes, sha256, version, zoom read), `tiles` file/bytes/sha256,
`layers.places.kinds` dots per kind and `rows_skipped`, `layers.seismic.lines` and `length_km` per zone,
`layers.risk` = `lines` and `length_km` per overlay id and level, and `source` = `communes_version` (the archive's
metadata, else the `manifest.json` next to it), `sha256`, `bytes`) and `overlays-report.json` (rows, dots, shared
positions, approximate dots, named dots per kind, skip reasons, the risk counts above, tile sizes per zoom, timings).
The workflow downloads the file named by `tiles.file` in the live `manifest.json`, checks its size and sha256 against
that manifest, and passes it with `--communes-file`; it then publishes `v<version>/overlays.pmtiles` (immutable) and
`overlays.json` (5 minutes), rewriting `tiles.file` to the versioned path as Build data does.

Privacy rules, applied in `places.py` and checked again by the gate:

- rows in partial diffusion (`STATUT_DIFFUSION = P`) are skipped (the file gives them no coordinates anyway);
- a name is kept only for the kinds marked `named` in `kinds.json` (public institutions and public-facing venues:
  hospitals, schools, universities, post offices, stations, pools, cinemas, libraries), never for GPs, dentists,
  pharmacies, crèches, bakeries or supermarkets, whose name is often a person's. The BPE cannot tell a public pool from a
  club's, so a pool can carry the club's name;
- no address, SIRET, capacity or other column reaches the tiles or the reports; no per-person name exists in them;
- rows of one kind at the same coordinates collapse into one dot with a count (59,495 GP rows are 30,019 dots).

Rows are kept when `EPSG = 2154` and the Lambert-93 position is inside the metropolitan extent (the rule of
`proximity.classify_position`, shared with the distances); `QUALITE_XY = M` is kept and flagged `a`. Names are
normalised in `names.py`: title case, French small words (de, du, des, la, le, les, et, sur, sous, en, au, aux and
d', l' after the first word) in lower case, a short fixed list of accents restored (école, collège, lycée,
bibliothèque, médiathèque, cinéma, hôpital, université, ...), a short list of abbreviations kept in capitals (CHU, LPO,
BP, UFR, ...), a cut at 60 characters on a word with an ellipsis. Rows at one position with different names show the
most frequent one.

National build of 2026-11-13 (BPE page release 2026-11-02): 248,362 dots from 303,089 rows; 16.1 MB archive, 15,637
tiles; the largest tile is z10 over central Paris, 195 KB gzipped (seismic lines: 7 KB). Seismic isolines: zone 2 11
lines / 3,777 km, zone 3 8 / 3,660 km, zone 4 6 / 2,046 km. `check_overlays.py` fails on a kind missing or outside its
national range (-15% / +25% around these counts), an unknown kind id, a name on an unnamed kind or over 60 characters,
a dot outside metropolitan France, a dot below its kind's `minzoom`, a seismic `z` outside 2..5, no line for the
zones 2, 3 and 4, a risk feature that is not a line, has properties other than `r` and `z`, an `r` outside the table or
a `z` that is not a level of its `r`, in the national mode a missing `risk` layer or an overlay id with no line at its
lowest level (flood, clay, radon, cavities: the gate names the id and the communes property to check), a tile over
400 KB gzipped, or an unreadable file. `--slice` skips the national ranges and the required layers.

## Known limits and shortcuts

- The Etalab contours fallback is not implemented, because the IGN GeoParquet source resolves and
  downloads fine. Adding it would mean a second reader for GeoJSON properties.
- Sales whose old code has no geolocation and no commune déléguée entry stay unmatched (national
  verification: 222 sales in 16 codes, 0.005%). They still count in their department.
- Yearly trend points need at least 5 sales in the year (`# deliberate:` below that, the yearly median is
  noise).
- Low-zoom commune tiles are heavy. All ~35k communes are kept from z4 by contract (filters must work at
  the national view), so the larger of the two z4 tiles is about 1.85 MB gzipped, z5 1.53 MB, z6 1.01 MB.
  Properties, not shapes, dominate: with only `code` the z4 tile would be 0.53 MB.
- Overseas departments (97x, and Saint-Pierre-et-Miquelon 975, whose department column is "NR") are
  excluded. Mayotte is excluded entirely.
- Distances are straight lines from one point of the commune, not travel times, and hide the variation
  inside large communes.
