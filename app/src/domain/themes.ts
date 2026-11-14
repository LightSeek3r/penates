import type { ExpressionSpecification } from 'maplibre-gl'
import { contrast } from './colour'
import { LAYERS, NO_DATA_COLOR, type ColourLayerId, type LayerDef, isColourLayer, layerById, layerColors, propertyOf } from './layers'
import type { PriceType } from './place'
import { HATCH_INK_DARK, HATCH_INK_LIGHT } from './priceLadder'

/** The layers that colour the map or serve as a second indicator; the others became overlays (layers.ts, `overlay`). */
export type ThemeId = ColourLayerId

// deliberate: a cast; ColourLayerId (type) and isColourLayer (value) state the same rule, and themes.test.ts checks they agree.
export const THEMES: readonly ThemeId[] = LAYERS.filter(isColourLayer).map((def) => def.id as ThemeId)

const THEME_SET: ReadonlySet<string> = new Set(THEMES)

export const isTheme = (value: string | null): value is ThemeId => value !== null && THEME_SET.has(value)

export function themeDef(theme: ThemeId): LayerDef {
  const def = layerById(theme)
  if (!def) throw new Error(`Unknown theme ${theme}`)
  return def
}

/** Colour of each class; an absent value or an unknown class code falls back to the no-data colour, never to a class. */
export function fillExpression(def: LayerDef, priceType: PriceType): ExpressionSpecification {
  const property = propertyOf(def, priceType)
  const colours = layerColors(def)
  const value: ExpressionSpecification = ['get', property]
  const coloured =
    def.scale.kind === 'classes'
      ? ['match', value, ...def.scale.values.flatMap((code, index) => [code, colours[index]]), NO_DATA_COLOR]
      : ['step', value, colours[0], ...def.scale.breaks.flatMap((limit, index) => [limit, colours[index + 1]])]
  return ['case', ['has', property], coloured, NO_DATA_COLOR] as unknown as ExpressionSpecification
}

export const themeFillExpression = (theme: ThemeId, priceType: PriceType): ExpressionSpecification => fillExpression(themeDef(theme), priceType)

/** Hatch ink with the better contrast on a fill colour (porcelain on dark classes, midnight on light ones). */
export const hatchInkOn = (fill: string): string => (contrast(fill, HATCH_INK_LIGHT) >= contrast(fill, HATCH_INK_DARK) ? HATCH_INK_LIGHT : HATCH_INK_DARK)

/**
 * Filters of the two hatch layers that mark rough estimates (for instance rents from few listings) on themes that
 * declare a `doubt` property; null for the others. The ink flips per class so it stays legible on its fill.
 */
export function doubtFilters(theme: ThemeId, priceType: PriceType): { light: ExpressionSpecification; dark: ExpressionSpecification } | null {
  const def = themeDef(theme)
  if (!def.doubt || def.scale.kind !== 'steps') return null
  const property = propertyOf(def, priceType)
  const colours = layerColors(def)
  const firstDark = colours.findIndex((colour) => hatchInkOn(colour) === HATCH_INK_DARK)
  // Expressions are JSON, so "every class" and "no class" are spelled with the largest safe integers, not infinities.
  const split = firstDark === -1 ? Number.MAX_SAFE_INTEGER : firstDark === 0 ? -Number.MAX_SAFE_INTEGER : def.scale.breaks[firstDark - 1]
  const doubtful: ExpressionSpecification = ['all', ['has', property], ['has', def.doubt.property], ['<', ['get', def.doubt.property], def.doubt.below]]
  return {
    light: ['all', doubtful, ['<', ['get', property], split]],
    dark: ['all', doubtful, ['>=', ['get', property], split]],
  }
}
