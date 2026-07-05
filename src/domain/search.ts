import type { Recipe } from '../db/schema'

/** Case-insensitive match across name, spirit, tags, and ingredient names. */
export function matchesQuery(recipe: Recipe, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (recipe.name.toLowerCase().includes(needle)) return true
  if (recipe.spirit?.toLowerCase().includes(needle)) return true
  if (recipe.tags.some((t) => t.toLowerCase().includes(needle))) return true
  return recipe.ingredients.some((i) => i.name.toLowerCase().includes(needle))
}
