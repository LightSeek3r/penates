---
name: settling-map
description: A France map printed as an IGN sheet in midnight enamel, where price is a luminous blue ladder and doubt is drawn as texture.
colors:
  ground: "#0B1B3A"
  panel: "#10264A"
  panel-raised: "#17335F"
  porcelain: "#F4F7FB"
  text-dim: "#B4C2DC"
  cobalt: "#2F6FDB"
  amber: "#F2A81D"
  scarlet: "#E03A2F"
  emerald: "#2FA36B"
  contour-orange: "#C8642B"
  price-0: "#1D3F85"
  price-1: "#2457B5"
  price-2: "#2F73D9"
  price-3: "#5E97EA"
  price-4: "#93BAF3"
  price-5: "#C9DBF8"
  price-6: "#F4F7FB"
  no-price: "#14264A"
  cross-low-low: "#4D4D4D"
  cross-mid-low: "#537B4B"
  cross-high-low: "#51AA3C"
  cross-low-mid: "#855E8D"
  cross-mid-mid: "#929292"
  cross-high-mid: "#9BC591"
  cross-low-high: "#BF6BD2"
  cross-mid-high: "#D0A6DA"
  cross-high-high: "#DEDEDE"
typography:
  display:
    fontFamily: "Noto Sans Variable, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1
  headline:
    fontFamily: "Noto Sans Variable, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Noto Sans Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Noto Sans Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Noto Sans Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "2px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button:
    backgroundColor: "transparent"
    textColor: "{colors.porcelain}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  button-hover:
    backgroundColor: "{colors.panel-raised}"
  segmented-option-selected:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.ground}"
    rounded: "{rounded.md}"
    height: "40px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    padding: "16px"
  search-input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    height: "40px"
---

# Design System: settling-map

## Overview

**Creative North Star: "The Midnight Sheet"**

settling-map is one national map sheet in the manner of an IGN Top 25 map, printed in midnight-blue enamel. Everything the visitor reads sits on a single cold ground (#0B1B3A): the map, the panels, the margin that carries the coordinates. Price is the one thing allowed to glow, so the whole country reads as a ladder of blue from deep cobalt to porcelain white. The interface is a working tool first (Operate mode): standard controls, tight hierarchy, nothing decorative that does not carry data.

The system's second idea is honesty drawn as material. A figure that rests on few sales, a commune with no sale at all, and a region the source does not cover each get their own texture instead of a colour, so uncertainty is never mistaken for a low price. The sheet furniture (neatline, Lambert-93 kilometre ticks, alternating scale bar) is there to make the map read as a real, measured document and to anchor the data to the ground.

It refuses the listing-site look (banners, orange calls to action, agent cards), the dated government GIS look (dense grey toolbars), the flashy dataviz demo (neon on black, showy motion) and alarmist styling (red warnings on risks).

**Key Characteristics:**
- One cold midnight ground; price is the only luminous element.
- Luminance-ordered single-hue ladder, safe without colour vision.
- Uncertainty is texture: hatch, dots, cross-hatch; never a price colour.
- Printed-sheet frame: neatline, Lambert-93 ticks, kilometre grid, alternating scale bar.
- Flat tonal panels with hairline borders; no shadows.
- Orange appears only as IGN-style road ink; amber is reserved for selection.

## Colors

A cold enamel ground with porcelain ink, one blue price ladder, and a small set of line inks that each have a single job.

### Primary
- **Luminous Cobalt Ladder** (#1D3F85 to #F4F7FB, seven steps): the price classes, from under 1,000 to 5,000+ €/m². Luminance rises monotonically with price, so the ladder reads in greyscale. Used only for price.

### Secondary
- **Selection Amber** (#F2A81D): the outline of the selected place and the keyboard focus ring. Nothing else.

### Tertiary
- **Road Orange** (#C8642B): motorways and trunk roads on the map, at about 55 % opacity, the IGN topographic accent.
- **Cobalt Line** (#2F6FDB): rivers and water edges.
- **Forest Emerald** (#2FA36B): woodland at 12 % opacity, barely there.
- **Error Scarlet** (#E03A2F): load or system errors only; never risk styling.

### Neutral
- **Midnight Enamel** (#0B1B3A): the ground of the app, the sea, the margin, and the ink of hatching on light price classes.
- **Deep Panel** (#10264A): panels, search field, dialogs.
- **Raised Panel** (#17335F): hover and pressed surfaces.
- **Porcelain** (#F4F7FB): text, ticks, borders at low opacity, hatching on dark price classes.
- **Dim Porcelain** (#B4C2DC): secondary text; at least 7:1 on the panels.
- **No-price Ground** (#14264A): communes with no sale or no coverage, always paired with a texture.

### Second indicator: the crossed palette
- **Crossed key** (nine colours, `cross-<theme tier>-<second tier>` above; source of truth `app/src/domain/combine.ts`): used only when a second indicator is crossed with the theme. Lightness rises with the sum of the two tiers and hue follows their difference, so the diagonal (both low, both middle, both high) is a neutral grey ramp that reads by lightness alone, moss green marks communes where the theme is higher, orchid those where the second indicator is higher.
- **Why these hues:** green and purple sit on opposite sides of both colour-vision axes (red-green and blue-yellow), so they stay apart for protanopes and deuteranopes (who keep blue-yellow) and for tritanopes (who keep red-green). Blue is price's, amber is selection's, red is never used, so none of them were available.
- **Verified, not eyeballed:** `contrast.test.ts` checks every cell against the no-data ground (at least 1.5:1) and its best hatch ink (at least 3:1), neighbours in the grid (at least 1.4:1) and diagonal steps (at least 2:1), and that all nine stay at least 0.08 apart in OKLab under normal vision and simulated protanopia, deuteranopia and tritanopia (Machado 2009). Cells sharing the same sum of tiers have the same lightness on purpose: only the diagonal is promised to read without colour.
- **Discs** (disc mode) are porcelain with a 1.5px midnight outline, 7, 11 and 16px across for the low, middle and high tiers. One of the two inks keeps at least 3:1 on every ladder colour, crossed cell and the no-data ground (also tested).

### Named Rules
**The One Ladder Rule.** The blue ladder belongs to price alone. No other element, chart or state may borrow its colours.

**The Amber Is Selection Rule.** Amber marks what the visitor has chosen and what has keyboard focus. It is never a warning or a risk colour.

**The Texture Carries Doubt Rule.** Uncertainty is drawn as texture and each texture keeps at least 3:1 contrast against its fill: porcelain hatch on the three darkest classes, midnight hatch on the rest, dense porcelain dots for "no sale kept", a quiet porcelain cross-hatch for "outside the source".

**The Second Voice Rule.** A second indicator speaks through the crossed palette or through discs, never through texture: hatch, dots and cross-hatch keep meaning doubt and gaps. In crossed colours the hatch means "at least one of the two figures is a rough estimate" (one fill cannot say which); a disc for a rough estimate is an open ring. A missing value is the no-data ground in crossed colours and no disc at all, never the low tier.

## Typography

**Display Font:** Noto Sans Variable (with system-ui, sans-serif)
**Body Font:** Noto Sans Variable
**Label/Mono Font:** none; tabular figures on prices

**Character:** One humanist sans for the interface and the map lettering, so the sheet speaks in a single voice. It is sentence case throughout, with weight and size, not capitals, carrying rank.

### Hierarchy
- **Display** (700, 2.25rem, 1): the median price figure in the details panel.
- **Headline** (700, 1.25rem, 1.2): the selected place name.
- **Title** (700, 1rem, 1.4): panel headings such as the layer name.
- **Body** (400, 0.875rem, 1.4): descriptions, facts, buttons, legend.
- **Label** (400, 0.75rem, 1.4): captions, hints, trend range, tick labels (drawn at 11px).
- **Map place names:** city 15px bold, town 13px, village 12px, fixed per rank; foreign names 11px at 60 % opacity.

### Named Rules
**The One Voice Rule.** Interface and map lettering share one family. A second face needs a user decision.

**The Sentence Case Rule.** No uppercase transforms. Units stay exact: "€/m²" is never rendered "€/M²".

## Layout

The page is a top bar over a full-bleed sheet. The map fills a framed area inset by the sheet margin (28px on wide screens, 12px on phones); the margin carries the neatline and the Lambert-93 tick labels. Panels float inside the frame: layers and legend stacked on the left (288px), the details panel on the right (320px). The spacing rhythm is 4, 8, 12, 16, 24px.

Below 720px the panels become bottom sheets over the map: the layers sheet opens on demand and the details sheet steps aside while it is open, so two sheets never overlap. The legend stays visible as a compact strip with the price ladder and the reliability key. Map controls move to the top-right so they never cover the country. On first load the whole of metropolitan France, Corsica included, is fitted inside the free area.

Touch targets are 44px minimum; buttons and fields are 40px tall on desktop pointers.

## Elevation & Depth

Flat by default. Depth comes from tonal layering (ground, panel, raised panel) and 1px hairline borders in porcelain at 14 % opacity (32 % for controls). There are no drop shadows. The selected place gains a porcelain tint, a midnight casing and an amber line instead of a glow.

### Named Rules
**The Flat Sheet Rule.** Nothing casts a shadow. A surface is distinguished by value and a hairline, as on a printed sheet.

## Shapes

Panels, buttons and fields share a 6px radius; reliability pips use 2px. The language toggle is a joined pair inside one rounded outline. Boundaries on the map are thin porcelain hairlines (20 % opacity) and the department outlines are slightly stronger. The map frame itself is a square neatline.

## Components

### Buttons
- **Shape:** 6px radius, 1px border in porcelain at 32 %.
- **Primary:** there is no filled primary; actions are outlined (40px tall, 12px side padding, 14px text).
- **Hover / Focus:** hover fills with the raised panel tone; focus shows a 2px amber outline offset by 2px.
- **Quiet:** borderless variant for close actions; the close icon is a drawn 16px cross in a 44px target.

### Segmented control (property type)
- **Style:** equal-width options, 1px border; the selected option is porcelain with midnight text and 600 weight.
- **State:** a native radio group, so keyboard arrows and screen readers work.

### Language toggle
- **Style:** joined "FR | EN" pair in one outline; the pressed language is filled porcelain with midnight text. Each button has the full language name as its accessible label.

### Search
- **Style:** deep-panel field, 1px border, 40px tall, with a combobox list below (44px rows, raised tone on hover or arrow selection).
- **Focus:** amber outline.

### Panels and legend
- **Style:** deep-panel ground, 16px padding, 6px radius, hairline border. The legend lists the seven price classes as swatches with labels, then a reliability key: plain (10 sales or more), hatch (fewer than 10), dots (no sale kept), cross-hatch (outside the source).

### Second indicator
- **Picker:** at the foot of the Colour tab, outside its scroll: a native select styled as the search field (grouped by family, never offering the theme itself or an opt-in layer before opt-in), the quiet drawn-cross button to remove it, and the segmented control for crossed colours or discs.
- **Crossed key:** a 3 x 3 table, the second indicator's tiers as rows (high on top), the theme's as columns (high on the right), tier ranges in the legend's own wording and units, axis names with drawn arrows; on phones the grid shrinks to short labels beside the axis names.
- **Disc key:** the three disc sizes with their tier ranges on one wrapping row, then "open ring: rough estimate" and "no disc: no data", then the note that discs are thinned when zoomed out.
- **Map:** discs sit under the selection outline, so the selected place stays fully outlined; place names draw over them.

### Details panel (signature component)
Shows the place name, the median price in the display size with its unit, a three-pip reliability meter that mirrors the map hatch, a plain-language sentence about how solid the figure is, the sales count and period, a yearly-median sparkline with its first and last values and percentage change, and the standing disclaimer. The sparkline's range never exaggerates a small change.

### Sheet furniture (signature component)
A neatline with kilometre ticks on four edges (100 km labelled, 10 km unlabelled from zoom 8), a faint Lambert-93 kilometre grid over the data, and an alternating light/dark scale bar with 0, half and full labels.

## Do's and Don'ts

### Do:
- **Do** keep price on the blue ladder and nowhere else.
- **Do** show every uncertainty as texture, with at least 3:1 contrast against its fill.
- **Do** label the outside-source area on the map and in the legend.
- **Do** give every figure its sample size, period and a plain-language reliability sentence.
- **Do** keep the interface and map lettering in one family, in sentence case.
- **Do** keep amber for selection and focus only.

### Don't:
- **Don't** show missing or thin data as a low-price colour.
- **Don't** draw a second indicator as a texture, or a missing value as its smallest disc or lowest tier.
- **Don't** use red or scarlet for risk, crime or any non-error state; risk layers stay calm.
- **Don't** add drop shadows, gradients or glows to panels.
- **Don't** let panels cover the neatline or two bottom sheets overlap on phones.
- **Don't** style the page like a listing site: no banners, no orange calls to action, no agent-style cards.
- **Don't** render foreign place names at French rank.
