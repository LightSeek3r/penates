# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + TypeScript + Vite, MapLibre GL for the map, PMTiles for vector tiles. Confirmed by the user ("sure, if there's nothing better"). Static app on Cloudflare Pages; tile and data files on Cloudflare R2; Supabase only for optional saved shortlists. Intended domain: unit42.fr (settling.unit42.fr for the app).

## Users

General curious public, open to anyone in or moving to France. The concrete situation behind the product is choosing where to buy a home or apartment, but the audience is not narrowed to one persona (first-time buyer, relocating household or investor were offered and the user chose "general curious public"). Vocabulary and defaults must work for people with no real-estate expertise.

## Product Purpose

An interactive, reactive map of France that overlays open data relevant to choosing where to live and buy: price per m², population density, flood and other natural risks, altitude, seismic and climate exposure, sunshine, hospitals, schools, recorded crime, and more. Success: a visitor can understand how places compare and narrow down areas that fit their constraints, while knowing how reliable each number is.

## Positioning

Four claims, all confirmed by the user, that neighbouring tools (Géorisques, the DVF explorer, MeilleursAgents, Kelquartier) do not make together:

- Constraint-first search: set budget and must-haves, see where everything fits at once.
- Honest uncertainty: every figure shows its sample size, data date and limits; missing data is never shown as "safe".
- Open and auditable: open-source code, open data, visible licences and methods.
- Affordability view: enter a budget, see the surface that budget buys in each area.

## Operating Context

Two modes on one shared constraint engine: Explore (toggle layers and read the map) and Search (constraints and affordability). Explore ships first. Native data grain is commune and IRIS; address-level results are computed on demand only. Metropolitan France first. Data is rebuilt in CI from open French sources and published as static files; the app has no backend for core features.

## Capabilities and Constraints

- Layers planned: price per m² (DVF), rents, energy label (DPE), tax rate, seismic zone, clay shrink-swell, flood zones (TRI), cavities, radon, altitude, sunshine hours, hospitals, GP access, schools, equipment, fibre, recorded crime (opt-in), population.
- On-demand per-address sun shading is planned, subject to LiDAR HD coverage (unverified).
- Data limits that must stay visible: DVF excludes Alsace-Moselle (57, 67, 68) and Mayotte; DVF is aggregated only (no per-sale pages, not search-indexable, no re-identification); small communes are hidden in crime data; risk layers are indicative and do not replace the legal ERRIAL; rents are asking rents.
- Required attributions are tracked in docs/data-licences.md.
- Undecided: grid below commune/IRIS (200 m), overseas territories, public launch date, whether the repo stays private until launch.

## Brand Commitments

Name: settling-map. No logo, voice or visual identity decided; none binding.

## Evidence on Hand

Open datasets verified 2026-11-04 (see .claude/plans/settling-map-v1.md). No users, testimonials, benchmarks or press exist yet; none may be invented.

## Product Principles

1. Show uncertainty, not false precision: every number carries its sample size, date and limits.
2. Absence of data is not safety: gaps are shown as gaps.
3. Constraints before scores: users set what matters; no hidden weights or single opaque ranking.
4. Open by default: code, methods, sources and licences are inspectable.
5. Sensitive layers are opt-in and carefully worded (recorded crime in particular).

## Accessibility & Inclusion

Required, per the user: mobile-first usable (core flow works on a phone); WCAG AA (keyboard, screen reader, contrast, colour-blind-safe map palettes); no account and no individual tracking for core features (accounts only for optional saved shortlists; no cookies; the only measurement is anonymous daily totals with no identifier, which the visitor can switch off, and Do Not Track is respected); every string, legend and disclaimer in French and English.
