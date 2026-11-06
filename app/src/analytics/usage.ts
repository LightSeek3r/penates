import { track } from './track'
import { activeFilterKeys } from '../domain/filters'
import type { Filters } from '../domain/filters'
import { layerById } from '../domain/layers'
import type { ThemeId } from '../domain/themes'

interface UsageState {
  theme: ThemeId
  filters: Filters
  selection: unknown
}

interface Store {
  subscribe: (listener: (state: UsageState, previous: UsageState) => void) => () => void
}

// Opt-in layers (recorded crime) are never counted: using them stays entirely within the browser.
const counted = (id: string) => layerById(id)?.optIn !== true

/** Counts which colour theme, which filter and how many selections visitors use. Values come from closed lists. */
export function startUsageTracking(store: Store): () => void {
  return store.subscribe((state, previous) => {
    if (state.theme !== previous.theme && counted(state.theme)) track('theme', state.theme)
    const before = new Set(activeFilterKeys(previous.filters))
    for (const key of activeFilterKeys(state.filters)) if (!before.has(key) && counted(key)) track('filter', key)
    if (state.selection && state.selection !== previous.selection) track('select')
  })
}
