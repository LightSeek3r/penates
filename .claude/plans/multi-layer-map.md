# Several indicators on the map at once

Requested 2026-11-09: one colour layer at a time is not enough; the map needs visual cues and several layers at the same
time, perhaps as combinations.

## Constraints that shape the design

- PRODUCT principle 3, "constraints before scores": no hidden weights, no single opaque ranking. A weighted composite
  score is therefore out; every encoding must be readable back to the two indicators it shows.
- DESIGN.md "Texture Carries Doubt": hatch, dots and cross-hatch already mean uncertainty. A second indicator must not
  reuse them, and must keep >= 3:1 contrast against the fill.
- Colour-blind-safe, WCAG AA, readable without colour, FR + EN strings, mobile first.
- Filters already combine constraints (they dim communes that fail). They stay as they are.
- No data rebuild: everything uses properties the tiles already carry (`tileFields` tells which exist).

## Design

Today: `theme` colours the communes. New: an optional **second indicator** (`compare`) with two ways to show it, chosen
by the visitor (`mix`):

1. **Cross** (`mix=cross`): bivariate choropleth. Each indicator is cut into 3 tiers (low / middle / high, from the
   layer's own breaks, so tiers always mean the legend classes the visitor already knows); the fill is one of 9 colours
   of a 3 x 3 grid, with a 3 x 3 legend key whose axes are labelled with the two indicator names and tier ranges.
   Reads "where is X high *and* Y low". Palette: colour-blind-safe, light-to-dark along both axes, distinguishable
   without colour by lightness alone on the diagonal; must not use amber (selection) and must not look like the price
   ladder.
2. **Marks** (`mix=marks`): the primary theme keeps the fill; the second indicator is drawn as a proportional symbol per
   commune (3 sizes: small, medium, large), a dual-ink disc (porcelain core, midnight outline) so contrast does not
   depend on the fill. Symbols thin out by collision at low zoom; no symbol where the value is missing (absence is not
   a "low" value, DESIGN rule "Absence of data is not safety").

Both: a legend section for the second indicator, a clear way to remove it, URL state (`th2=<id>&mix=cross|marks`),
details panel keeps listing every indicator, sources dialog/credits already cover each indicator. Opt-in layers stay
opt-in for `compare`. A `compare` equal to `theme`, or missing in the tiles, is dropped (same rule as `theme`).

Out of scope: more than two indicators at once (filters cover the rest), weighted scores, saved combinations.

## Steps

1. Domain: `tiersOf(def)` (two cut values in tile units for steps and class scales; documented), 9-colour palette,
   `crossFillExpression`, marks expression helpers; unit tests, including contrast of every cell against the hatch inks
   and against its neighbours.
2. State: `compare`, `mix` in store + URL (parse/format round trip, invalid values ignored, opt-in/missing fallbacks).
3. Map: bivariate fill replaces the theme fill expression; marks symbol layer + generated icons (`patterns.ts` style);
   doubt/price hatch layers keep working with cross mode (decide and test what happens to the price confidence hatch).
4. UI: ControlPanel "Add a second indicator" (picker excluding the theme, mix toggle, remove), Legend (3 x 3 key,
   marks key), i18n FR + EN, keyboard and screen-reader labels.
5. Verification: unit tests, `pnpm lint`, typecheck, `pnpm e2e` (add a spec: choose a second indicator in each mode,
   assert URL state, legend, no console errors), screenshots of both modes reviewed by eye on desktop and a phone
   viewport, independent finish review (impeccable), DESIGN.md + methodology/docs updated.
