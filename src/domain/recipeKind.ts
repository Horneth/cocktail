import type { Recipe, RecipeKind } from '../db/schema'

// The one place the app names and labels a recipe's kind. Every screen that
// lets you pick a kind, label a card, or decide "is this a drink or a mixer"
// goes through here, so the vocabulary can't drift across files the way the old
// tags/methods/glasses lists once did.

export const RECIPE_KINDS: RecipeKind[] = ['cocktail', 'syrup']

export const KIND_LABELS: Record<RecipeKind, string> = {
  cocktail: 'Cocktail',
  syrup: 'Syrup',
}

export const KIND_EMOJI: Record<RecipeKind, string> = {
  cocktail: '🍸',
  syrup: '🍯',
}

// Older schemas this code keeps reading: the pre-split single "component" kind
// (named with the `subRecipeId` cross-link field), and the "cordial" kind that
// later folded into "syrup".
type LegacyRecipe = {
  kind?: string
  ingredients?: Array<Record<string, unknown>>
}

/**
 * Normalize a recipe written by an older schema onto the current one: "component"
 * and "cordial" become "syrup", and `subRecipeId` becomes `recipeId`. Used by
 * the DB migrations (db.ts) and by backup import (import/backup.ts). Returns
 * the input unchanged when there is nothing to rewrite.
 */
export function migrateLegacyRecipe(recipe: Recipe): Recipe {
  const legacy = recipe as unknown as LegacyRecipe
  let changed = false
  const next: Recipe = { ...recipe }

  if (legacy.kind === 'component' || legacy.kind === 'cordial') {
    next.kind = 'syrup'
    changed = true
  }

  if (legacy.ingredients) {
    const ingredients = legacy.ingredients.map((ing) => {
      if (ing.subRecipeId === undefined) return ing
      changed = true
      const { subRecipeId, ...rest } = ing
      return { ...rest, recipeId: subRecipeId }
    })
    if (changed) next.ingredients = ingredients as unknown as Recipe['ingredients']
  }

  return changed ? next : recipe
}
