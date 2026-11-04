# settling-map pipeline

Builds `communes.pmtiles`: median property price per m² (DVF) by commune and by department, for
metropolitan France and Corsica. Pure Python: DuckDB for tabular work, shapely + mapbox-vector-tile +
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
`--workers N` (tile encoding processes).

The build is idempotent: downloads are cached in `data/raw/` and re-used when their size matches; the
tile archive is byte-identical between runs on the same day (gzip mtime 0, sorted tiles).

Outputs in `--out`:

- `communes.pmtiles`: layers `departments` (z0-7) and `communes` (z6-10).
- `manifest.json`: version (UTC date), source dates, tile file name/bytes/sha256, counts, confidence histogram.
- `build-report.json`: row counts at each cleaning step, code reconciliation, per-department values,
  spot checks, tile sizes per zoom, step timings, and per-area aggregates (n, p25, median, p75, window).

No output or log contains per-sale data. The cleaned sales exist only inside the in-memory DuckDB
connection (spill files, if any, go to `data/raw/duckdb-tmp/`).

## Sources

| Source | How it is resolved |
|---|---|
| geo-DVF, 5-year single file (DGFiP / Etalab) | data.gouv.fr API, dataset `demandes-de-valeurs-foncieres-geolocalisees`, the one `csv.gz` resource whose title contains "fichier unique". Size and published sha1 are verified. The timestamped static URL is never hardcoded; `files.data.gouv.fr/geo-dvf/latest` is not used. |
| IGN ADMIN EXPRESS COG-CARTO-PE | Géoplateforme download API, `https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG-CARTO-PE`. The newest edition matching `*__GEOPARQUET_WGS84G_FRA_<date>` is picked (verified: `ADMIN-EXPRESS-COG-CARTO-PE_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01`). Layers used: `commune.parquet`, `arrondissement_municipal.parquet`, `departement.parquet`, `commune_associee_ou_deleguee.parquet` (GeoParquet 1.1, WKB column `geometrie`, EPSG:4326). |

Attribution in the tiles: `© IGN, DGFiP/Etalab (Licence Ouverte v2.0)`.

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

## Tiles (`settling/tiles.py`)

Contract (the app depends on it):

- `departments` z0-7: `code`, `name`, `p_*`, `n_*`, `c_*`, `w`, `period`.
- `communes` z6-10 (overzoomed above): `code`, `name`, `dep`, `p_*`, `n_*`, `c_*`, `t2021..t2025`, `w`, `period`.
- `*` is `all`, `mai` or `app`. Integers only, except `code`, `name`, `dep`, `period` (`YYYY-MM/YYYY-MM`).
  Missing values are omitted.
- The MVT feature id is the numeric INSEE code, with 2A/2B → 201/202 (MVT ids must be unsigned integers).
  The app should use `promoteId: "code"` and ignore the numeric id.

Method: Web Mercator. Each zoom gets one Douglas-Peucker pass (`preserve_topology`) with a tolerance of
1 tile unit at extent 4096 (1/8 px on a 512 px tile). Each tile then gets: clip with a 64-unit buffer,
snap to the integer grid (`set_precision`), MVT encode, gzip. Empty tiles are not written. Tiles are
encoded in a process pool. Neighbouring polygons are simplified independently, so shared borders can
differ by up to 1 unit. `# deliberate:` this is invisible at that size and avoids a topology library.

## Known limits and shortcuts

- The Etalab contours fallback is not implemented, because the IGN GeoParquet source resolves and
  downloads fine. Adding it would mean a second reader for GeoJSON properties.
- Sales whose old code has no geolocation and no commune déléguée entry stay unmatched (national
  verification: 222 sales in 16 codes, 0.005%). They still count in their department.
- Yearly trend points need at least 5 sales in the year (`# deliberate:` below that, the yearly median is
  noise).
- Low-zoom commune tiles are heavy. All ~35k communes are kept at z6 by contract (dropping them would
  punch holes in the choropleth), so the densest z6 tile (Paris basin) is about 0.85 MB gzipped.
- Overseas departments (97x) are excluded from v1 tiles. Mayotte is excluded entirely.
