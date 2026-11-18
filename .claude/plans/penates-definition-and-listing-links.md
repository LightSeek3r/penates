# Pénates definition + listing links

Status: decisions answered 2026-11-18, implemented. Portals shipped: Bien'ici, Leboncoin, SeLoger (PAP, Logic-Immo, Immonot need private geo IDs, not derivable). Postal code on demand from geo.api. Definition in empty panel + Sources + SEO intro. Phones: empty panel is hidden <720px, so the definition is only in Sources there. URLs unverified (portals unreachable from the build container): click-test each.
Origin: user feedback. (1) Nobody knows what "pénates" means. (2) A user wants links to the listings (annonces) for a given city or zone.

## 1. Define "pénates" in the UI

Text (FR): **Pénates** /pe.nat/ — nom masculin pluriel. Dieux protecteurs du foyer dans la Rome antique ; par extension, la maison où l'on vit (« regagner ses pénates »).
Text (EN): **Pénates** (pay-NAHT) — the household gods of ancient Rome; by extension, one's home.
IPA is the single source for the phonetic form; keep `[pe.nat]` in FR, plain-English respelling in EN (EN readers do not read IPA).

Placement (proposal):
- [ ] `inspector.empty` state (visible on first load, nothing selected): add a short definition block under the hint. No new chrome in the top bar.
- [ ] Sources and limits dialog: one "À propos du nom / About the name" paragraph at the top.
- [ ] `app/content/seo.{fr,en}.json` description: add the meaning once (helps search snippets). Check `app/vite/seo-content.ts` for how it is consumed.
- [ ] i18n keys in `fr.json` + `en.json` (both required by PRODUCT.md); mark phonetic with `<span lang>`/`<bdi>` so screen readers do not mispronounce.

Open: on phones the Inspector empty state may sit in a collapsed sheet. Verify it is seen on first load at 360 px; if not, put a one-line definition in the sheet header instead.

## 2. Listing links per commune / zone

Behaviour: in the commune Inspector, a "Voir les annonces / See listings" block with outbound links to portal search pages pre-filtered on the selected commune (sale, house + flat). Department selection: link at department level where the portal supports it.

Constraints from PRODUCT.md:
- No tracking: plain `<a target="_blank" rel="noopener noreferrer">`, no redirect through our domain, no affiliate params. Analytics: at most an anonymous daily total (existing `analytics/track.ts`), respecting DNT.
- Pénates is not a listings site and must say so: label "Annonces chez des tiers", neutral order (alphabetical), no ranking.
- Do not imply listings = the DVF prices shown (DVF is past sales, listings are asking prices).
- FR + EN strings. WCAG AA: link text names the portal and the commune; mark external.

Technical:
- Tile props today carry `code` (INSEE), `name`, `dep`. **No postal code.** Portals differ: some take INSEE, some name + postal code, some use private geo IDs (not derivable).
- Candidate source for postal code: `geo.api.gouv.fr/communes/{code}?fields=codesPostaux` on demand (already used by Search, same privacy profile, fails offline → hide block) OR bake `codesPostaux` into tiles in `pipeline/settling/build.py` (heavier, no runtime call).
- New pure module `app/src/domain/listings.ts`: `listingLinks(place): {portal, url}[]` with unit tests (Paris/Lyon/Marseille arrondissements, multi-postal-code communes, accents/hyphens in names, communes with no postal code).
- New component block in `Inspector.tsx` (commune only); CSS in `app.css`; i18n keys.

Risks:
- URL formats are portal-owned and change; portals are bot-protected so the links cannot be verified from this container. Need user to click-test each, or restrict to formats known stable. Add a ceiling comment + one-place registry so a broken portal is a one-line fix.
- Alsace-Moselle / Mayotte: no DVF price but listings still exist; the block should still show.

## Decisions needed from user
1. Which portals (SeLoger, Leboncoin, Bien'ici, PAP, Logic-Immo, Immonot, Figaro Immo…).
2. Postal code: on-demand `geo.api.gouv.fr` vs baked in tiles.
3. Definition placement as proposed, or also top bar?
