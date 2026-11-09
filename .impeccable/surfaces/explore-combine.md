---
version: 1
slug: "explore-combine"
primary_target: "explore-combine"
related_targets: ["app/src/ui/Legend.tsx","app/src/ui/ControlPanel.tsx","app/src/map/appearance.ts"]
---

# Surface brief: Explore, two indicators at once

## Scope and mode

Operate. An extension of the Explore surface (see explore.md): a visitor shows a second indicator together with the
colour theme, on desktop and on a 390 px phone, in French and English, keyboard and screen-reader operable.

## Task and constraints

The visitor asks "where is X high and Y low" (cross) or "how does Y sit over the X map" (discs). Constraints that shape
it: no weighted score (PRODUCT principle 3); texture already means doubt (DESIGN "Texture Carries Doubt"), so the second
indicator never uses hatch, dots or cross-hatch; absent values are never drawn as a tier or a disc size; amber stays
selection; the blue ladder stays price. Filters are unchanged and keep dimming communes.

## Direction contract

THESIS: the second indicator is a second ink on the same printed sheet, not a new instrument. Cross mode reprints the
communes in a nine-colour bivariate key; disc mode overprints porcelain discs, as a thematic overlay on an IGN sheet.

OWN-WORLD: midnight ground, porcelain and midnight inks only for discs (dual ink, one of the two always at 3:1 on any
fill); the crossed palette is neutral grey on the diagonal (lightness carries "both low" to "both high"), moss green
where the theme leads, orchid where the second indicator leads. No amber, no blue ladder, no red.

STORY: pick a second indicator under the theme list, choose crossed colours or discs with the existing segmented
control, read it from a 3 x 3 key or a three-size disc key, remove it with the same drawn cross as the details panel.

FIRST VIEWPORT: unchanged Explore layout. The picker sits at the foot of the Colour tab, outside its scroll, so it is in
reach whatever group is open; the legend key replaces (cross) or follows (discs) the ladder. On phones the key folds
into the legend strip: grid with short tier labels beside the two axis names.

FORM: existing components only: native select styled as the search field, segmented control, quiet icon button,
legend swatches and state rows. Disc key drawn in SVG with the same diameters and inks as the map icons.

FINISH: unit tests for tiers, palette (WCAG and simulated dichromacy), expressions and state; e2e for both modes;
screenshots at 1440 x 900 and 390 x 844 reviewed; DESIGN.md and the methodology pages updated.
