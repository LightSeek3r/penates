# SEO and PWA

Status: IN PROGRESS (requested by the user 2026-11-05: "App will need full SEO and PWA support too"). Runs in parallel with `phase-2-themes-and-filters.md`.

## Legal constraint on SEO (decides the scope)

DGFiP's DVF terms of use forbid reuse that makes the data search-indexable or that can re-identify people. So: NO crawlable page per sale, and NO page-per-commune price pages for now (aggregates are likely fine, but that is a legal reading to confirm with the user first). SEO targets the app itself, its two language versions and static documentation pages.

## SEO

- Real URLs per language: `/` (French, default) and `/en/` (English). Hash keeps only map state. The language toggle navigates between them (a full load, so head and content are correct).
- Per language: title, description, canonical, `hreflang` (fr, en, x-default), Open Graph, Twitter card, theme-color, 1200x630 social image rendered from the real product.
- JSON-LD: `WebSite` and `WebApplication` (free, inLanguage, license of the data sources noted in the description).
- Crawlable content inside `#root` (replaced by React on mount): one `h1`, an intro, what the map shows, limits, links to the docs pages. `<noscript>` notice.
- Static documentation pages generated at build from markdown: method, sources and licences, (legal notice once the user supplies publisher details). FR and EN, canonical + hreflang + breadcrumb JSON-LD.
- `robots.txt`, `sitemap.xml` with hreflang alternates, `_headers` (cache policy, security headers, CSP).
- Performance for Core Web Vitals: font preload, lazy map chunk where useful, immutable asset caching.

## PWA

- Web app manifest (name, short name, theme and background `#0B1B3A`, standalone, icons 192/512/maskable, apple-touch-icon, shortcuts, screenshots), generated icons from one SVG mark.
- Service worker (Workbox via vite-plugin-pwa, `injectManifest`): precache the app shell; runtime caching for fonts and the OpenFreeMap basemap tiles visited; manifest network-first; tile file served from cache with HTTP Range support when the user has chosen "available offline".
- UI: install button (when the browser offers it), update-ready notice, offline-download control with size and progress, offline state indicator. All in FR/EN.
- Update flow without surprise reloads (prompt, not auto-reload mid-use).

## Verification

- Vitest for pure helpers (Range slicing, head/JSON-LD builders, sitemap).
- Playwright against the production build: manifest valid and linked, service worker controlling the page, offline reload shows the app, no installability errors (CDP), per-route SEO tags, robots/sitemap contents, no CSP violations in the console.
- Lighthouse (SEO, accessibility, best practices) on the live site from GitHub Actions; thresholds enforced for SEO and accessibility.

## Decisions

- Legal notice and privacy page: built from the publisher identity already published on unit42.fr (individual publisher, contact address, Cloudflare as host), with privacy text written from what this app actually does. Page lives in `docs/legal*.md` and is generated in both languages.
- Per-commune public pages: dropped by the user ("seems excessive"). The DVF terms also argue against making the data indexable. Not planned.

## Open point

- The zone unit42.fr may have Cloudflare Web Analytics switched on for the whole zone. This app's CSP blocks third-party scripts, so no analytics would run on settling.unit42.fr, which matches the "no tracking" promise; a console warning would show if the beacon were injected. Excluding the hostname in Cloudflare Web Analytics would silence it.
