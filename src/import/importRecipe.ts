import { db } from '../db/db'
import type { Ingredient, Recipe, RecipeLink } from '../db/schema'
import { newId } from '../domain/ids'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Writes a StructuredImport into the DB in a single transaction:
//  1. insert (or reuse) each component, deduping shared ones by name+kind
//  2. resolve ingredient.subRecipeRef (tempId) -> real subRecipeId
//  3. insert the main recipe
//  4. reconcile recipeLinks for every recipe that gained sub-recipe links
//
// Used by seed data now and by phase-2 YouTube import later — the only shared
// write path into the recipe store.

function draftToIngredient(
  draft: IngredientDraft,
  tempIdToRealId: Map<string, string>,
): Ingredient {
  const ing: Ingredient = {
    id: newId(),
    name: draft.name,
    amount: draft.amount,
    unit: draft.unit,
  }
  if (draft.optional !== undefined) ing.optional = draft.optional
  if (draft.note !== undefined) ing.note = draft.note
  if (draft.subRecipeRef) {
    const realId = tempIdToRealId.get(draft.subRecipeRef)
    if (realId) ing.subRecipeId = realId
  }
  return ing
}

function draftToRecipe(
  draft: RecipeDraft,
  tempIdToRealId: Map<string, string>,
  now: number,
): Recipe {
  const id = tempIdToRealId.get(draft.tempId) ?? newId()
  return {
    id,
    kind: draft.kind,
    name: draft.name,
    ingredients: draft.ingredients.map((d) => draftToIngredient(d, tempIdToRealId)),
    measureBasis: draft.measureBasis,
    baseServings: draft.baseServings ?? 1,
    glassware: draft.glassware,
    method: draft.method,
    garnish: draft.garnish,
    instructions: draft.instructions,
    tags: draft.tags ?? [],
    spirit: draft.spirit,
    notes: (draft.notes ?? []).map((text) => ({ id: newId(), text, createdAt: now })),
    source: draft.source,
    createdAt: now,
    updatedAt: now,
  }
}

function linksForRecipe(recipe: Recipe): RecipeLink[] {
  return recipe.ingredients
    .filter((i) => i.subRecipeId)
    .map((i) => ({
      id: newId(),
      parentId: recipe.id,
      childId: i.subRecipeId as string,
      ingredientId: i.id,
    }))
}

export interface ImportResult {
  mainId: string
  componentIds: string[]
}

export async function importRecipe(data: StructuredImport): Promise<ImportResult> {
  const now = Date.now()

  return db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    const tempIdToRealId = new Map<string, string>()

    // 1. Resolve components first (main ingredients reference them by tempId).
    //    Dedupe shared components (e.g. Simple Syrup) by name+kind so importing
    //    a second drink that also uses it reuses the existing record.
    const componentIds: string[] = []
    for (const compDraft of data.components) {
      const existing = await db.recipes
        .where('name')
        .equalsIgnoreCase(compDraft.name)
        .filter((r) => r.kind === compDraft.kind)
        .first()

      if (existing) {
        tempIdToRealId.set(compDraft.tempId, existing.id)
        componentIds.push(existing.id)
      } else {
        const realId = newId()
        tempIdToRealId.set(compDraft.tempId, realId)
        const recipe = draftToRecipe({ ...compDraft, tempId: compDraft.tempId }, tempIdToRealId, now)
        await db.recipes.put(recipe)
        await db.recipeLinks.bulkPut(linksForRecipe(recipe))
        componentIds.push(realId)
      }
    }

    // 2. Insert the main recipe with resolved sub-recipe ids.
    const mainRecipe = draftToRecipe(data.main, tempIdToRealId, now)
    await db.recipes.put(mainRecipe)
    await db.recipeLinks.bulkPut(linksForRecipe(mainRecipe))

    return { mainId: mainRecipe.id, componentIds }
  })
}

/**
 * Persist edits to a single existing recipe and reconcile its links.
 * Used by the edit screen (not the importer). Replaces the recipe's link rows.
 */
export async function saveRecipe(recipe: Recipe): Promise<void> {
  await db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    recipe.updatedAt = Date.now()
    await db.recipes.put(recipe)
    await db.recipeLinks.where('parentId').equals(recipe.id).delete()
    await db.recipeLinks.bulkPut(linksForRecipe(recipe))
  })
}

/** Toggle a recipe's favorite flag (lightweight field update). */
export async function setFavorite(recipeId: string, favorite: boolean): Promise<void> {
  await db.recipes.update(recipeId, { favorite })
}

/** Delete a recipe and any link rows that reference it (as parent or child). */
export async function deleteRecipe(recipeId: string): Promise<void> {
  await db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    await db.recipes.delete(recipeId)
    await db.recipeLinks.where('parentId').equals(recipeId).delete()
    await db.recipeLinks.where('childId').equals(recipeId).delete()
  })
}
