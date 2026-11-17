# Contributing to Pénates

Thanks for taking an interest. Pénates is a small, one-person project, so the process is light.

## Reporting a problem

- **A bug or an idea:** open an [issue](https://github.com/LightSeek3r/penates/issues/new/choose) and pick
  the matching template. For a layout bug, include the screen size and a screenshot.
- **A wrong or doubtful figure:** use the *Data problem* template. Give the commune (name or INSEE code),
  the indicator, the value shown and what you expected, with a source if you have one. The method and its
  limits are in [docs/methodology.md](docs/methodology.md); a number that follows the documented rules,
  even a surprising one, is not a bug.
- **A wrong or clumsy translation:** use the *Translation problem* template (the app is French and English).
- **A security or privacy problem:** do not use an issue. See [SECURITY.md](SECURITY.md).

## Running it locally

See **Getting started** in the [README](README.md). In short:

```bash
cd app && pnpm install
VITE_DATA_BASE=https://settling-tiles.unit42.fr pnpm dev
```

The data pipeline needs Python 3.11 (`pipeline/README.md`).

## Sending a pull request

1. Open an issue first for anything larger than a fix, so we agree on the direction.
2. Branch from `main`, keep the change small and focused.
3. Run the checks CI runs:

   ```bash
   cd app
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   cd .. && python -m pytest pipeline/tests -q
   ```

   `pnpm e2e` runs the browser tests against the production build (`npx playwright install` once).
4. Put the reason in the PR description. For UI changes, add before/after screenshots, including one
   on a phone.

### House rules

- **Honest uncertainty.** Every figure shows its sample size and limits. Missing data is shown as missing,
  never as 0 or as "safe". A new indicator comes with its method, source and licence in `docs/`.
- **Aggregates only.** Nothing that describes an individual sale, address or person may enter the tiles,
  the repository or a page (DVF terms of use).
- **Add the data licence first.** Add the row to [docs/data-licences.md](docs/data-licences.md) (and its
  French twin) before a layer ships, with the credit the licence requires.
- **No third-party requests** from the app beyond the tile host and the basemap, no cookies, and no
  analytics beyond the anonymous daily counters.
- **French and English together.** Every visible string lives in both `app/src/i18n/*.json` files.
- **LF line endings** everywhere (`.gitattributes` enforces it).
- **Comments say why, not what.** Add a test for logic you touch.

By contributing you agree that your contribution is released under the [MIT licence](LICENSE). Data keeps
the licence of its source. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md): be kind.
