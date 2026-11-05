# settling-map

Interactive map of France to help choose where to buy a home, built from open data. Today: median price per m² with its reliability. Planned: risks (seismic, clay, flood), altitude, sunshine, amenities.
Carte interactive de la France pour choisir où acheter, à partir de données ouvertes. Aujourd'hui : prix médian au m² et sa fiabilité. À venir : risques, altitude, ensoleillement, équipements.

Live: https://settling.unit42.fr (Explore: median price per m² by commune, with reliability). Method and limits: [docs/methodology.md](docs/methodology.md). Plans: [.claude/plans/](.claude/plans/).

## Modes

- **Explore** (live): read the map, add layers.
- **Search** (planned): set a budget and must-haves, see which areas match.

## Repository

- `app/`: React + TypeScript + MapLibre front end (`pnpm dev`, `pnpm test`, `pnpm e2e`).
- `pipeline/`: Python data build that turns open data into PMTiles (`pipeline/README.md`).
- `.github/workflows/`: CI, data build, deploy, smoke and production e2e.

## Data

Today's data: DGFiP/Etalab (DVF) and IGN boundaries, plus OpenStreetMap for the basemap. Other open French sources are planned (Géorisques, INSEE, Météo-France, SSMSI, ANS, DREES, ADEME, ARCEP, ANIL). Licences and required attributions: [docs/data-licences.md](docs/data-licences.md).

Risk layers are indicative only and do not replace the legal *état des risques* (ERRIAL). Crime figures are offences recorded by police and gendarmerie, not actual crime.

## Licence

Code: MIT. Data: original licences of each source.
