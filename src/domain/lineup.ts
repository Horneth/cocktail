import type { Recipe } from '../db/schema'
import { canMake, categorySubstitutions, isGarnishLine, isStocked, missingBottles, normIngredient, type Substitution } from './availability'
import { tileKeyForRecipe, tileMeta } from './spirits'
import { canonical, METHODS } from './vocab'

// "Pour a round" — the host curates a menu; the app informs the choice. Pure
// logic over the same availability engine the rest of the app reads, so a bar
// can't make a drink here that Home calls missing.
//
// The lineup is never chosen FOR the host: `pickLineup` feeds only the optional
// starter-three row, `catalog` presents every drink with its status as a
// decision input (ready / one bottle away / short), and `needsFor` turns the
// chosen menu into a shopping list. All deterministic — same shelf, same
// output — so tests are exact.

const METHOD_STYLE: Record<string, string> = {
  Shake: 'Shaken',
  Stir: 'Stirred',
  Build: 'Built',
  Blend: 'Blended',
  Throw: 'Thrown',
  Swizzle: 'Swizzled',
}

/** "Shake" + gin → "Shaken · Gin". Falls back to whatever the recipe says. */
export function styleLabel(recipe: Recipe): string {
  const parts: string[] = []
  const method = canonical(recipe.method, METHODS)
  if (method) parts.push(METHOD_STYLE[method] ?? method)
  const spirit = tileKeyForRecipe(recipe)
  if (spirit !== 'other') parts.push(tileMeta(spirit).label)
  return parts.join(' · ') || 'Cocktail'
}

function styleKey(recipe: Recipe): string {
  const method = canonical(recipe.method, METHODS) ?? 'Mixed'
  return `${method}|${tileKeyForRecipe(recipe)}`
}

function difficulty(recipe: Recipe): number {
  return recipe.ingredients.filter((i) => !i.optional).length
}

function easyFirst(a: Recipe, b: Recipe): number {
  return difficulty(a) - difficulty(b) || a.name.localeCompare(b.name)
}

export interface LineupEntry {
  recipe: Recipe
  style: string
  /** ingredients satisfied by a same-family bottle ("your rum for Jamaican rum") */
  subs: Substitution[]
}

/**
 * A short method-diverse, spirit-diverse, easy-first pick from the makeable
 * set — used only for the optional starter-three row when the menu is empty,
 * never as a section of its own. Deterministic: same shelf, same suggestion.
 */
export function pickLineup(
  cocktails: Recipe[],
  byId: Map<string, Recipe>,
  have: Set<string>,
  assumeStaples: boolean,
  count = 3,
): LineupEntry[] {
  const ready = cocktails
    .filter((r) => canMake(r, have, byId, assumeStaples))
    .sort(easyFirst)
  const entry = (r: Recipe): LineupEntry => ({
    recipe: r,
    style: styleLabel(r),
    subs: categorySubstitutions(r, have, assumeStaples),
  })
  if (ready.length <= count) return ready.map(entry)

  // One bucket per style, each easiest-first, buckets ordered by their easiest
  // drink. Pass 1 takes one from every bucket; later passes round-robin,
  // preferring a spirit the lineup hasn't poured yet.
  const buckets = new Map<string, Recipe[]>()
  for (const r of ready) {
    const key = styleKey(r)
    const list = buckets.get(key)
    if (list) list.push(r)
    else buckets.set(key, [r])
  }
  const rounds = [...buckets.values()].sort((a, b) => easyFirst(a[0], b[0]))
  const picked: LineupEntry[] = []
  const poured = new Set<string>()
  const take = (r: Recipe) => {
    poured.add(tileKeyForRecipe(r))
    picked.push(entry(r))
  }
  const rest: Recipe[][] = []
  for (const bucket of rounds) {
    if (picked.length >= count) {
      rest.push(bucket)
      continue
    }
    take(bucket[0])
    if (bucket.length > 1) rest.push(bucket.slice(1))
  }
  while (picked.length < count && rest.length) {
    let took = false
    for (let i = 0; i < rest.length && picked.length < count; i++) {
      const bucket = rest[i]
      if (!bucket.length) continue
      let idx = bucket.findIndex((r) => !poured.has(tileKeyForRecipe(r)))
      if (idx === -1) idx = 0
      take(bucket[idx])
      bucket.splice(idx, 1)
      took = true
    }
    if (!took) break
  }
  return picked
}

export interface NeedItem {
  /** normalized match key */
  key: string
  /** display spelling, as the recipe wrote it */
  label: string
  /** how many drinks of the menu call for it */
  count: number
  /** the bar already answers this call — exact bottle or same family */
  stocked: boolean
}

/**
 * The complete shopping list for the chosen menu — every non-optional line the
 * drinks call for, alcohols included (a chip covering them is still worth
 * seeing on one list), deduped by match key. Garnish-word lines (peel, twist,
 * wedge) are skipped; a "to top" soda is not a garnish and stays — a G&T
 * without tonic isn't a G&T.
 *
 * What isn't stocked yet sorts first: that half is the shopping list, and its
 * pills write real bottles into the bar when tapped (the manifest is a shelf
 * editor, not bookkeeping — one source of truth, nothing can drift).
 */
export function needsFor(menu: Recipe[], have: Set<string>): NeedItem[] {
  const tally = new Map<string, { label: string; count: number }>()
  for (const r of menu) {
    for (const ing of r.ingredients ?? []) {
      if (ing.optional) continue
      const key = normIngredient(ing.name)
      if (!key || isGarnishLine(key)) continue
      const entry = tally.get(key)
      if (entry) entry.count += 1
      else tally.set(key, { label: ing.name.trim(), count: 1 })
    }
  }
  return [...tally.entries()]
    .map(([key, { label, count }]) => ({
      key,
      label,
      count,
      stocked: isStocked(label, have),
    }))
    .sort(
      (a, b) =>
        Number(a.stocked) - Number(b.stocked) || b.count - a.count || a.label.localeCompare(b.label),
    )
}

// ── The catalog ──────────────────────────────────────────────────────────────

export type CatalogTier = 'ready' | 'close' | 'out'

/** Ready pours first, then the one-bottle-away drinks, then the short ones. */
const TIER_RANK: Record<CatalogTier, number> = { ready: 0, close: 1, out: 2 }

export interface CatalogEntry {
  recipe: Recipe
  style: string
  tier: CatalogTier
  /** what the bar is short of — exactly one name when tier is 'close' */
  missing: string[]
  /** non-optional ingredient count, the "how much work" signal */
  effort: number
}

/**
 * Every drink as a decision input: status tiered ready → one bottle away →
 * short, easy-first within a tier. The catalog screen filters these by
 * segment; the badges and "Needs X" names are the availability information,
 * never a place of their own.
 */
export function catalog(
  cocktails: Recipe[],
  byId: Map<string, Recipe>,
  have: Set<string>,
  assumeStaples: boolean,
): CatalogEntry[] {
  return cocktails
    .map((recipe) => {
      const ready = canMake(recipe, have, byId, assumeStaples)
      const missing = ready ? [] : missingBottles(recipe, have, byId, assumeStaples)
      return {
        recipe,
        style: styleLabel(recipe),
        tier: ready ? ('ready' as const) : missing.length === 1 ? ('close' as const) : ('out' as const),
        missing,
        effort: difficulty(recipe),
      }
    })
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        a.effort - b.effort ||
        a.recipe.name.localeCompare(b.recipe.name),
    )
}