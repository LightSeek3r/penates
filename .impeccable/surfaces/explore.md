---
version: 1
slug: "explore"
primary_target: "explore"
related_targets: []
---

# Surface brief: Explore (national map)

## Scope and mode

Operate. Explore is the first screen of Pénates: a working map tool, mobile-first and desktop equally, bilingual FR/EN, WCAG AA, no account or tracking. Search mode (constraints, affordability) is a later surface on the same constraint engine.

## Task and constraints

Audience: general curious public choosing where to live or buy in France. Task: see France by median price per m², add layers, read how reliable each number is, narrow by constraints. First 10 seconds: the national price map is the first screen with search always present. Avoid: real-estate listing look, dated GIS/government tool, flashy dataviz demo, alarmist risk styling. Honest uncertainty is visible in the map itself (thin samples hatched, no-data distinct from cheap). Unresolved: contour relief needs the altitude layer (phase 2); until then use a coarse or omitted relief. Overseas territories undecided.

## Direction contract

THESIS: One national sheet in the grammar of an IGN Top 25 map, printed in midnight enamel. It refuses the listing-site arrangement and the generic dashboard: price, risk and amenities read as map furniture, and uncertainty is drawn into the map.

OWN-WORLD: Midnight enamel ground #0B1B3A for shell and map, porcelain white (#F4F7FB) labels and ticks, IGN orange contour lines as low-opacity relief, a thin cobalt kilometre grid with sheet-edge scale bar, price as a luminous ladder from deep cobalt to porcelain, muted emerald forests and cobalt water, amber for risk and selection, scarlet only for errors, Noto Sans, a humanist sans, as the single family for both interface and map lettering (the free glyph host serves only the Noto Sans family, and one voice beats two), at fixed sizes per place rank. Approved by the user on 2026-11-05 ("Keep Noto Sans"), after an independent review flagged it against the original "humanist transit sans".

STORY: The visitor sees all of France priced at once, understands how reliable each area's number is, adds layers, and narrows by their own constraints.

FIRST VIEWPORT: Top bar (logo, search, FR|EN toggle); left legend-sheet layer rail of grouped checkboxes; full-bleed France sheet with the price ladder, hatched thin-sample communes, km grid and scale bar; right inspector for the selected commune (median EUR/m2, sample size N and date, five-year trend, honest-limits note); price legend bottom-left. On phones the rail and inspector become bottom sheets over the map.

FORM: IGN Top 25 sheets (rank 1 on my list, the pick card), fused at the user's request with the Midnight Transit Diagram palette (catalog challenger wayfinding-cartography-signage-midnight-transit-diagram); user-pinned over the roll. seed: cd9a8364ec0e2581

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
