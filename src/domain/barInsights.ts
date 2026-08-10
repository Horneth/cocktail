import type { Recipe } from '../db/schema'
import { makeableIds, missingBottles, normIngredient } from './availability'

// "What do I get for adding this bottle?" — the payoff signal the Bar screen
// shows next to every add. Deliberately computed on-device from the user's own
// library: it's the availability engine run twice, so it costs nothing, works
// offline, and never sends the inventory anywhere.

export interface UnlockResult {
  /** how many recipes become makeable */
  unlocks: number
  /** which ones, so the caller can name them ("unlocks Mai Tai + 2 more") */
  recipeIds: string[]
}

export interface UnlockSuggestion extends UnlockResult {
  /** normalized match key */
  name: string
  /** display spelling, as the recipe wrote it */
  label: string
}

const EMPTY: UnlockResult = { unlocks: 0, recipeIds: [] }

/**
 * Exactly how many recipes adding `labels` would unlock: |makeable(have ∪ labels)|
 * − |makeable(have)|. Correct for combinations (two bottles that only pay off
 * together), so this is what a review sheet totals with — but it runs the whole
 * engine twice, so only call it for a handful of bottles at a time. Pass
 * `baseline` when scoring several candidates against the same inventory.
 */
export function unlocksFor(
  labels: string[],
  cocktails: Recipe[],
  byId: Map<string, Recipe>,
  have: Set<string>,
  assumeStaples: boolean,
  baseline?: Set<string>,
): UnlockResult {
  const after = new Set(have)
  for (const label of labels) {
    const key = normIngredient(label)
    if (key) after.add(key)
  }
  if (after.size === have.size) return EMPTY

  const before = baseline ?? makeableIds(cocktails, byId, have, assumeStaples)
  const gained = [...makeableIds(cocktails, byId, after, assumeStaples)].filter((id) => !before.has(id))
  return { unlocks: gained.length, recipeIds: gained }
}

// Scoring every catalog entry with `unlocksFor` would be O(catalog × recipes).
// Instead: one pass over the recipes finds the bottles that are the *only* thing
// standing between the user and a drink, and only that shortlist gets scored
// exactly. This many candidates get re-scored — enough that the exact pass can
// reorder the top few without turning back into the naive sweep.
const SHORTLIST = 12

/**
 * The bottles most worth buying next: unstocked ingredients that single-handedly
 * unlock the most drinks. The cheap pass (one `missingBottles` per recipe) picks
 * the shortlist; the exact pass re-scores it, because category substitution means
 * one bottle can also cover drinks that were waiting on a differently-named
 * bottle of the same family — an undercount the tally alone can't see.
 */
export function oneAwaySuggestions(
  cocktails: Recipe[],
  byId: Map<string, Recipe>,
  have: Set<string>,
  assumeStaples: boolean,
  limit = 3,
): UnlockSuggestion[] {
  const tally = new Map<string, { label: string; count: number }>()
  for (const recipe of cocktails) {
    const missing = missingBottles(recipe, have, byId, assumeStaples)
    if (missing.length !== 1) continue
    const key = normIngredient(missing[0])
    if (!key || have.has(key)) continue
    const entry = tally.get(key)
    if (entry) entry.count += 1
    else tally.set(key, { label: missing[0], count: 1 })
  }
  if (!tally.size) return []

  const baseline = makeableIds(cocktails, byId, have, assumeStaples)
  return [...tally.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, Math.max(limit, SHORTLIST))
    .map(([name, { label }]) => ({
      name,
      label,
      ...unlocksFor([label], cocktails, byId, have, assumeStaples, baseline),
    }))
    .filter((s) => s.unlocks > 0)
    .sort((a, b) => b.unlocks - a.unlocks || a.label.localeCompare(b.label))
    .slice(0, limit)
}
