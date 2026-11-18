# Changelog

All notable changes to Pénates (developed under the working name settling-map) are listed here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org) loosely while the project is 0.x. Versions before 0.8.0 are
tagged retroactively from the development history.

## [Unreleased]

### Added

- The meaning and pronunciation of "Pénates" (/pe.nat/) in the empty details panel, in "Sources and
  limits" and on the SEO home page, in French and English.
- "See listings" links in a commune's details to Bien'ici and Leboncoin searches for that commune,
  limited to houses or flats when the price layer is filtered that way. The postal code is looked up
  on demand from geo.api.gouv.fr; the links are plain outbound links with no tracking.
- On phones, where the details panel is hidden, a short gloss of the name replaces the tagline in the
  top bar.

## [0.8.0] - 2026-11-17

First public release of the source. The map runs at <https://penates.unit42.fr>.

### Changed

- **The product is named Pénates** everywhere a visitor reads it: the top bar, page titles, the web
  manifest, the share images and install screenshots, the SEO pages, the legal notice and the
  documentation. The canonical address is `penates.unit42.fr`. The data host
  (`settling-tiles.unit42.fr`), the Python package (`settling`) and the storage keys are unchanged.
- The "Sources and limits" dialog shows the app version and a link to the source on GitHub.

### Added

- Open-source project files: contributing guide, code of conduct, security policy, issue and pull
  request templates, Dependabot, and a release workflow driven by this changelog. The CI actions are
  on v7.

### Security

- Dependencies updated within their ranges (MapLibre GL 6.19, vite 8.3.8, wrangler 4.164, Playwright 1.65,
  zustand 5.1...), the style-spec pin follows MapLibre, and `glob` is overridden to ^14.0.6 inside
  `workbox-build`, which clears the build-time `glob` and `minimatch` advisories. The one remaining
  `pnpm audit` finding is a ReDoS in vite's `picomatch`, which has no patched release yet; it only
  affects the dev and build tooling, never the shipped app.

## [0.7.0] - 2026-11-14

### Added

- **Overlays tab.** Risks as zone lines (seismic, flood, clay, radon, cavities) and places as dots
  (hospitals, schools, shops, stations and more) over the colour theme, from a separate overlays
  archive built by the pipeline.

### Changed

- The production end-to-end workflow reads the live tile host, so the overlay and indicator tests run
  instead of skipping.

### Fixed

- Clay and cavity lines start at zoom 7, where scattered communes stop reading as noise in the country
  view.

## [0.6.0] - 2026-11-10

### Added

- Altitude is read from a committed table for the 2026-01-01 boundaries (34,788 communes, checked
  against the altimetry API), with a regeneration command.

### Fixed

- The data build retries dropped connections, timeouts and 5xx responses on every request with growing
  waits, and resumes a cut download; Géorisques files use the resumable download.

## [0.5.0] - 2026-11-09

### Added

- **A second indicator on the map**, crossed 3x3 colours or sized discs; `th2` and `mix` in the link.

### Fixed

- Altitude relief ignores pixels contaminated by gaps in the elevation model, and retries a download
  that was cut short.
- Phones open at zoom 4 or more, so a communes-only theme paints at the default view.

## [0.4.0] - 2026-11-06

### Added

- **Many more indicators**: pluggable commune layers in the pipeline (Géorisques risks, altitude,
  climate, fibre, recorded crime, rent and land tax, seven more amenity distances), driven in the app by
  one layer catalogue for themes, filters, legend, details and links. Recorded crime is opt-in.
- Projected hot days (TRACC +2.7 °C) in the climate layer.
- Indicators the tiles lack are hidden; credits and methodology for every new source.

## [0.3.0] - 2026-11-06

### Added

- `/admin`: anonymous daily counters, Cloudflare Access verification and a privacy switch.

### Changed

- Map performance: MapLibre loads in a lazy chunk after the first paint, the service worker registers
  once the map has loaded, the kilometre grid is a static asset, hover picking is throttled and the
  phone pixel ratio is capped.

## [0.2.0] - 2026-11-05

### Added

- **Colour themes, filters, SEO pages and PWA**, with seismic zone and straight-line distances to six
  kinds of services tiled from zoom 4.
- Bilingual legal notice and privacy page, and a Lighthouse audit workflow.

## [0.1.0] - 2026-11-05

### Added

- **Explore core:** the price pipeline (DVF, IGN boundaries), the tiler, and the "Midnight Top 25" map
  interface with its printed-sheet furniture, uncertainty encodings and FR/EN toggle.
- Data build and deploy workflows, a plausibility gate before publishing, and smoke and production
  end-to-end checks.

[Unreleased]: https://github.com/LightSeek3r/penates/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/LightSeek3r/penates/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/LightSeek3r/penates/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/LightSeek3r/penates/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/LightSeek3r/penates/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/LightSeek3r/penates/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/LightSeek3r/penates/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/LightSeek3r/penates/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LightSeek3r/penates/releases/tag/v0.1.0
