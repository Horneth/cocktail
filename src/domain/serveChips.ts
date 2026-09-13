import type { Recipe } from '../db/schema'
import { isStaple, normIngredient } from './availability'
import { MATCHABLE_CATEGORIES, categoryForName } from './spiritCategory'
import { spiritSortIndex, tileMeta } from './spirits'

export interface ServeChip {
  label: string
  key: string
  category?: string
}

export type ServeIngredientGroupKey = 'alcohol' | 'juice' | 'modifier' | 'garnish'

export interface ServeIngredientGroup {
  key: ServeIngredientGroupKey
  label: string
  chips: ServeChip[]
  collapsible?: boolean
}

function chip(label: string, category?: string): ServeChip {
  return { label, key: normIngredient(label), category }
}

function cocktailRecipes(recipes: Recipe[]): Recipe[] {
  return recipes.filter((r) => r.kind === 'cocktail')
}

function ingredientEntries(recipes: Recipe[]): { label: string; key: string }[] {
  const seen = new Map<string, string>()
  for (const r of cocktailRecipes(recipes)) {
    for (const ing of r.ingredients ?? []) {
      if (ing.optional) continue
      const key = normIngredient(ing.name)
      if (key && !seen.has(key)) seen.set(key, ing.name.trim())
    }
  }
  return [...seen.entries()].map(([key, label]) => ({ key, label }))
}

function isAlcohol(label: string): boolean {
  const category = categoryForName(label)
  return !!category && MATCHABLE_CATEGORIES.has(category)
}

const GARNISH_RE = /\b(peel|twist|wheel|wedge|slice|zest|sprig|leaf|leaves|garnish|rind|dust|grated|shaved|cherry|olive)\b/i
const JUICE_RE = /\b(juice|citrus|lemonade|soda|tonic|cola|coke|seltzer|sparkling|ginger beer|ginger ale|pineapple|cranberry|grapefruit|syrup|grenadine|orgeat|honey|agave|sugar|water|cream|milk|coconut|egg)\b/i

function isGarnish(label: string): boolean {
  return GARNISH_RE.test(label)
}

function isJuiceOrSyrup(label: string): boolean {
  return JUICE_RE.test(label)
}

function exactChips(recipes: Recipe[], predicate: (label: string) => boolean, limit = 14): ServeChip[] {
  return ingredientEntries(recipes)
    .filter(({ label }) => predicate(label))
    .map(({ label }) => chip(label, categoryForName(label)))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, limit)
}

/**
 * Base spirit families the cocktail library actually calls for. Family-level
 * only: no brands or styles become controls in the fast path.
 */
export function familyChips(recipes: Recipe[]): ServeChip[] {
  const wanted = new Set<string>()
  for (const { label } of ingredientEntries(recipes)) {
    const category = categoryForName(label)
    if (category && MATCHABLE_CATEGORIES.has(category)) wanted.add(category)
  }
  return [...wanted]
    .sort((a, b) => spiritSortIndex(a) - spiritSortIndex(b))
    .map((category) => chip(tileMeta(category).label, category))
}

/** Exact drink-building ingredients, excluding family alcohols and garnishes. */
export function modifierChips(recipes: Recipe[], limit = 14): ServeChip[] {
  return exactChips(
    recipes,
    (label) => !isAlcohol(label) && !isGarnish(label) && !isJuiceOrSyrup(label) && !isStaple(normIngredient(label)),
    limit,
  )
}

/** Juices, syrups, sodas and other non-alcoholic drink-building ingredients. */
export function juiceChips(recipes: Recipe[], limit = 14): ServeChip[] {
  return exactChips(recipes, (label) => !isAlcohol(label) && !isGarnish(label) && isJuiceOrSyrup(label), limit)
}

/** Garnishes are useful but rarely decide a drink, so their group starts closed. */
export function garnishChips(recipes: Recipe[], limit = 14): ServeChip[] {
  return exactChips(recipes, (label) => isGarnish(label), limit)
}

export function ingredientGroupForName(name: string): ServeIngredientGroupKey {
  if (isAlcohol(name)) return 'alcohol'
  if (isGarnish(name)) return 'garnish'
  if (isJuiceOrSyrup(name)) return 'juice'
  return 'modifier'
}

export function ingredientGroups(recipes: Recipe[]): ServeIngredientGroup[] {
  const groups: ServeIngredientGroup[] = [
    { key: 'alcohol', label: 'Alcohol', chips: familyChips(recipes) },
    { key: 'juice', label: 'Juices & syrups', chips: juiceChips(recipes) },
    { key: 'modifier', label: 'Modifiers', chips: modifierChips(recipes) },
    { key: 'garnish', label: 'Garnishes', chips: garnishChips(recipes), collapsible: true },
  ]
  return groups.filter((group) => group.chips.length > 0)
}

/** Staples surfaced in the Juices & syrups group when the assumption is off. */
export const BASICS_CHIPS: ServeChip[] = [
  'Lime juice',
  'Lemon juice',
  'Grapefruit juice',
  'Orange juice',
  'Egg white',
  'Soda water',
  'Ginger beer',
  'Mint',
].map((label) => chip(label))
