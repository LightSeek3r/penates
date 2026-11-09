import type { ExpressionSpecification } from 'maplibre-gl'
import { NO_DATA_COLOR, type LayerDef, classCount, classIndex, propertyOf } from './layers'
import { CONFIDENCE, type PriceType } from './place'
import { HATCH_INK_LIGHT } from './priceLadder'
import { hatchInkOn } from './themes'

/**
 * A second indicator shown with the theme: `cross` colours each commune by the pair of tiers (a 3 x 3 bivariate
 * fill), `marks` keeps the theme's fill and draws one disc per commune sized by the second indicator's tier.
 */
export type Mix = 'cross' | 'marks'
export const MIXES: readonly Mix[] = ['cross', 'marks']
export const isMix = (value: string | null): value is Mix => MIXES.some((mix) => mix === value)

/** Low, middle, high. */
export type Tier = 0 | 1 | 2
export const TIERS: readonly Tier[] = [0, 1, 2]

/**
 * A layer cut into three tiers made of whole legend classes, so a tier always reads as a run of the classes the
 * visitor already knows: two cut values in tile units for step scales (a value equal to a cut belongs to the tier
 * above, as with breaks), the class codes of each tier for class scales.
 */
export type TierSplit =
  | { readonly kind: 'steps'; readonly cuts: readonly [number, number] }
  | { readonly kind: 'classes'; readonly codes: readonly [readonly number[], readonly number[], readonly number[]] }

/** First class index of the middle and of the high tier: the layer's own choice, or three near-equal runs. */
function tierStarts(def: LayerDef): readonly [number, number] {
  const count = classCount(def)
  return def.tiers ?? [Math.round(count / 3), Math.round((2 * count) / 3)]
}

export function tiersOf(def: LayerDef): TierSplit {
  const [middle, high] = tierStarts(def)
  if (def.scale.kind === 'steps') return { kind: 'steps', cuts: [def.scale.breaks[middle - 1], def.scale.breaks[high - 1]] }
  const { values } = def.scale
  return { kind: 'classes', codes: [values.slice(0, middle), values.slice(middle, high), values.slice(high)] }
}

/** Tier of a tile value, or null when the value is not one of the layer's class codes. */
export function tierOf(def: LayerDef, value: number): Tier | null {
  const index = classIndex(def, value)
  if (index === null) return null
  const [middle, high] = tierStarts(def)
  return index >= high ? 2 : index >= middle ? 1 : 0
}

/** Tier of the feature's value as an expression; -1 for an unknown class code. Callers check the value is present. */
function tierExpression(def: LayerDef, priceType: PriceType): ExpressionSpecification {
  const value: ExpressionSpecification = ['get', propertyOf(def, priceType)]
  const split = tiersOf(def)
  if (split.kind === 'steps') return ['step', value, 0, split.cuts[0], 1, split.cuts[1], 2]
  return ['match', value, ...split.codes.flatMap((codes, tier) => [[...codes], tier]), -1] as unknown as ExpressionSpecification
}

const hasValue = (def: LayerDef, priceType: PriceType): ExpressionSpecification => ['has', propertyOf(def, priceType)]

/**
 * Bivariate palette, `CROSS_COLORS[second tier][theme tier]`. Lightness rises with the sum of the two tiers and the
 * hue with their difference: moss green where the theme leads, orchid where the second indicator leads, neutral
 * grey on the diagonal, so the diagonal reads by lightness alone. DESIGN.md explains the choice; contrast.test.ts
 * checks it under simulated colour-vision deficiencies.
 */
export const CROSS_COLORS = [
  ['#4D4D4D', '#537B4B', '#51AA3C'],
  ['#855E8D', '#929292', '#9BC591'],
  ['#BF6BD2', '#D0A6DA', '#DEDEDE'],
] as const

export const crossColor = (themeTier: Tier, secondTier: Tier): string => CROSS_COLORS[secondTier][themeTier]

/** One value per pair of tiers; `fallback` wherever either value is absent or an unknown class code. */
function perCell(theme: LayerDef, second: LayerDef, priceType: PriceType, cell: (themeTier: Tier, secondTier: Tier) => string, fallback: string): ExpressionSpecification {
  const row = (themeTier: Tier) => ['match', tierExpression(second, priceType), ...TIERS.flatMap((secondTier) => [secondTier, cell(themeTier, secondTier)]), fallback]
  const cells = ['match', tierExpression(theme, priceType), ...TIERS.flatMap((themeTier) => [themeTier, row(themeTier)]), fallback]
  return ['case', ['all', hasValue(theme, priceType), hasValue(second, priceType)], cells, fallback] as unknown as ExpressionSpecification
}

/** A commune missing either value takes the no-data colour: absence is never drawn as a tier. */
export const crossFillExpression = (theme: LayerDef, second: LayerDef, priceType: PriceType): ExpressionSpecification =>
  perCell(theme, second, priceType, crossColor, NO_DATA_COLOR)

/**
 * True for features whose value is a rough estimate: price from fewer than 10 sales, or a layer's own `doubt`
 * property under its threshold. Null for layers that never are.
 */
export function roughCondition(def: LayerDef, priceType: PriceType): ExpressionSpecification | null {
  if (def.id === 'price') return ['==', ['get', `c_${priceType}`], CONFIDENCE.low]
  if (!def.doubt) return null
  return ['all', ['has', def.doubt.property], ['<', ['get', def.doubt.property], def.doubt.below]]
}

/**
 * Filters of the two hatch layers in cross mode. One hatch means "at least one of the two figures is a rough
 * estimate": a cell has a single fill, so the hatch cannot say which. The ink follows the cell colour (porcelain on
 * dark cells, midnight on light ones) to keep 3:1. Null when neither layer can be rough.
 */
export function crossDoubtFilters(theme: LayerDef, second: LayerDef, priceType: PriceType): { light: ExpressionSpecification; dark: ExpressionSpecification } | null {
  const rough = [roughCondition(theme, priceType), roughCondition(second, priceType)].filter((condition) => condition !== null)
  if (rough.length === 0) return null
  const ink = perCell(theme, second, priceType, (themeTier, secondTier) => (hatchInkOn(crossColor(themeTier, secondTier)) === HATCH_INK_LIGHT ? 'light' : 'dark'), 'none')
  const doubtful: ExpressionSpecification = ['any', ...rough]
  return { light: ['all', doubtful, ['==', ink, 'light']], dark: ['all', doubtful, ['==', ink, 'dark']] }
}

/** Disc diameters of the low, middle and high tiers, in CSS pixels; areas roughly double from one to the next. */
export const MARK_DIAMETERS = [7, 11, 16] as const

/** Image of a mark: a filled disc, or an open ring for a rough estimate (texture is taken by the fill's doubt). */
export const markIcon = (tier: Tier, rough: boolean): string => `mark-${rough ? 'open' : 'solid'}-${tier}`

/** Communes that get a mark: those with a known value; an absent value gets no symbol rather than the small one. */
export const marksFilter = (def: LayerDef, priceType: PriceType): ExpressionSpecification => ['all', hasValue(def, priceType), ['!=', tierExpression(def, priceType), -1]]

export function marksIconExpression(def: LayerDef, priceType: PriceType): ExpressionSpecification {
  const icons = (rough: boolean) => ['match', tierExpression(def, priceType), ...TIERS.flatMap((tier) => [tier, markIcon(tier, rough)]), '']
  const rough = roughCondition(def, priceType)
  return (rough ? ['case', rough, icons(true), icons(false)] : icons(false)) as unknown as ExpressionSpecification
}
