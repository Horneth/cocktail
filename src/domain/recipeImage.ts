import type { Recipe } from '../db/schema'
import { IMAGE_CATALOG, glassKind } from './recipeImages'
import type { CocktailImage, ImageGlassKind } from './recipeImages'

// Suggests the closest pre-generated catalog photos for a recipe being built or
// edited. Pure and framework-free — the editor calls `suggestImages` with the
// in-progress recipe fields and shows the top few thumbnails, which update as
// the drink takes shape.
//
// Scoring, in order of weight:
//  - glassware: the strongest single signal (a coupe sour should offer coupe
//    sours first), but never absolute — a mix of glasses still surfaces.
//  - keyword hits between the catalog slot's `keywords` and the recipe's
//    tags/spirit/garnish/ingredients — what turns a "Mai Tai" toward the tiki.
//  - a spirit hint so tequila drinks prefer tequila looks, rum drinks rum, etc.
// The order is stable across equal scores via a slug nonce.

type RecipeSubset = Pick<
  Recipe,
  'name' | 'kind' | 'spirit' | 'glassware' | 'garnish' | 'ingredients' | 'tags'
>

/** A suggested catalog shot. */
export interface Suggestion {
  slot: CocktailImage
  score: number
}

function toWords(...vals: Array<string | undefined>): string[] {
  const out: string[] = []
  for (const v of vals) {
    if (!v) continue
    for (const t of v.split(/[,\s|/]+/)) {
      const w = t.toLowerCase().trim()
      if (w) out.push(w)
    }
  }
  return out
}

function glassOf(glass: string | undefined): ImageGlassKind | null {
  return glassKind(glass)
}

function scoreSlot(slot: CocktailImage, recipe: RecipeSubset): number {
  const terms = new Set<string>([
    ...toWords(recipe.name, recipe.spirit, recipe.garnish),
    ...(recipe.tags ?? []).flatMap((t) => toWords(t)),
    ...recipe.ingredients.flatMap((i) => toWords(i.name)),
  ])

  let score = 0
  // Glass is the strongest single signal — but only when we actually know the
  // recipe's glass; an unknown glass must not silently match every rocks slot.
  const recipeGlass = glassOf(recipe.glassware)
  if (recipeGlass && glassOf(slot.glass) === recipeGlass) score += 90
  // Catalog keyword hits.
  for (const kw of slot.keywords) {
    if (terms.has(kw.toLowerCase().trim())) score += 60
  }
  // Spirit bonus: catalog keyword present directly in recipe words.
  const spirit = recipe.spirit?.toLowerCase().trim()
  if (spirit && spirit.length > 1 && slot.keywords.some((k) => k === spirit)) score += 40
  return score
}

function tie(slug: string): number {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return h
}

/** Top `limit` catalog shots best matching `recipe`, best-first. */
export function suggestImages(
  recipe: RecipeSubset,
  limit = 4,
  catalog: CocktailImage[] = IMAGE_CATALOG,
): Suggestion[] {
  return catalog.map((slot) => ({ slot, score: scoreSlot(slot, recipe) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || tie(a.slot.slug) - tie(b.slot.slug))
    .slice(0, limit)
}

/** True when a catalog shot's glass matches the recipe's glass (both known). */
export function matchesGlass(slot: CocktailImage, recipe: RecipeSubset): boolean {
  const a = glassOf(slot.glass)
  const b = glassOf(recipe.glassware)
  return Boolean(a && b && a === b)
}