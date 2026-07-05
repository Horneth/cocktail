import type { Recipe } from '../db/schema'

// "Can I make this right now?" — matches a recipe's ingredients against the
// user's bar inventory (a set of normalized ingredient names).
//
// Two ideas keep it useful without forcing you to tick every lime:
//  1. `assumeStaples` (default on): common non-alcoholic basics — water, ice,
//     citrus, sugar, sodas, garnishes, egg — and any garnish/topper line (no
//     amount) are assumed on hand, so the bar only needs your *bottles*.
//  2. Sub-recipes recurse: a cocktail that needs Simple Syrup is makeable if you
//     have the syrup OR can make it from what's available.

/** Normalize an ingredient/bottle name to a stable match key. */
export function normIngredient(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parentheticals, e.g. "(2:1)", "(30 ml)"
    .replace(/\b(freshly|fresh|squeezed|homemade|home-made|chilled|cold|hot|good|quality|large|small|organic)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Non-alcoholic basics most bars just have. Stored normalized.
const STAPLES = new Set(
  [
    'water', 'hot water', 'boiling water', 'warm water', 'ice', 'crushed ice',
    'sugar', 'white sugar', 'granulated sugar', 'caster sugar', 'superfine sugar', 'brown sugar', 'demerara sugar',
    'salt', 'sea salt', 'kosher salt', 'saline', 'saline solution',
    'soda water', 'club soda', 'sparkling water', 'seltzer', 'carbonated water',
    'tonic', 'tonic water', 'cola', 'coke', 'ginger beer', 'ginger ale', 'lemonade',
    'mint', 'mint leaves', 'mint sprig', 'fresh mint',
    'egg', 'egg white', 'whole egg', 'egg yolk',
    'lime', 'lime juice', 'lemon', 'lemon juice', 'orange juice',
    'grapefruit', 'grapefruit juice', 'pineapple juice', 'cranberry juice',
    'cherry', 'maraschino cherry', 'brandied cherry', 'olive', 'olives',
    'honey', 'agave', 'agave nectar', 'agave syrup',
  ].map(normIngredient),
)

// Garnish/finish words — a line that is essentially a garnish is assumed too.
const GARNISH_RE = /\b(peel|twist|wheel|wedge|slice|zest|sprig|leaf|leaves|garnish|rind|dust|grated|freshly grated|shaved)\b/

/** Whether an ingredient counts as an assumed basic (only when assumeStaples). */
export function isStaple(normName: string): boolean {
  if (!normName) return true
  if (STAPLES.has(normName)) return true
  return GARNISH_RE.test(normName)
}

interface Ctx {
  have: Set<string>
  byId: Map<string, Recipe>
  assumeStaples: boolean
}

function makeable(recipe: Recipe, ctx: Ctx, visited: Set<string>): boolean {
  if (visited.has(recipe.id)) return false // cycle guard
  visited.add(recipe.id)
  for (const ing of recipe.ingredients ?? []) {
    if (ing.optional) continue
    const norm = normIngredient(ing.name)
    if (ctx.assumeStaples && (ing.amount === null || isStaple(norm))) continue
    if (ctx.have.has(norm)) continue
    // A sub-recipe you don't have a bottle of is still fine if you can make it.
    if (ing.subRecipeId) {
      const sub = ctx.byId.get(ing.subRecipeId)
      if (sub && makeable(sub, ctx, new Set(visited))) continue
    }
    return false
  }
  return true
}

/** Can this single recipe be made from the given inventory? */
export function canMake(
  recipe: Recipe,
  have: Set<string>,
  byId: Map<string, Recipe>,
  assumeStaples: boolean,
): boolean {
  return makeable(recipe, { have, byId, assumeStaples }, new Set())
}

/** The subset of `recipes` that are makeable now (byId should include sub-recipes). */
export function makeableIds(
  recipes: Recipe[],
  allById: Map<string, Recipe>,
  have: Set<string>,
  assumeStaples: boolean,
): Set<string> {
  const ctx: Ctx = { have, byId: allById, assumeStaples }
  const out = new Set<string>()
  for (const r of recipes) if (makeable(r, ctx, new Set())) out.add(r.id)
  return out
}

/**
 * The required ingredients a recipe is missing from inventory (top-level, not
 * counting assumed staples or makeable sub-recipes). Powers "you need: X, Y".
 */
export function missingBottles(
  recipe: Recipe,
  have: Set<string>,
  byId: Map<string, Recipe>,
  assumeStaples: boolean,
): string[] {
  const ctx: Ctx = { have, byId, assumeStaples }
  const missing: string[] = []
  for (const ing of recipe.ingredients ?? []) {
    if (ing.optional) continue
    const norm = normIngredient(ing.name)
    if (assumeStaples && (ing.amount === null || isStaple(norm))) continue
    if (have.has(norm)) continue
    if (ing.subRecipeId) {
      const sub = byId.get(ing.subRecipeId)
      if (sub && makeable(sub, ctx, new Set())) continue
    }
    missing.push(ing.name)
  }
  return missing
}
