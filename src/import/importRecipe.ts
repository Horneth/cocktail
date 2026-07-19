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

/**
 * Delete a recipe. If it was a sub-recipe used by other recipes, those parents
 * keep the ingredient but lose the (now-dangling) sub-recipe link, so nothing
 * points at a deleted record.
 */
export async function deleteRecipe(recipeId: string): Promise<void> {
  await db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    // strip the dangling subRecipeId from any parent that referenced this child
    const parentLinks = await db.recipeLinks.where('childId').equals(recipeId).toArray()
    for (const pid of [...new Set(parentLinks.map((l) => l.parentId))]) {
      const parent = await db.recipes.get(pid)
      if (!parent) continue
      let changed = false
      const ingredients = parent.ingredients.map((i) => {
        if (i.subRecipeId === recipeId) {
          changed = true
          const copy = { ...i }
          delete copy.subRecipeId
          return copy
        }
        return i
      })
      if (changed) await db.recipes.update(pid, { ingredients })
    }

    await db.recipes.delete(recipeId)
    await db.recipeLinks.where('parentId').equals(recipeId).delete()
    await db.recipeLinks.where('childId').equals(recipeId).delete()
  })
}

/** How many recipes reference this one as a sub-recipe. */
export async function countUsage(recipeId: string): Promise<number> {
  const links = await db.recipeLinks.where('childId').equals(recipeId).toArray()
  return new Set(links.map((l) => l.parentId)).size
}

export interface MergeResult {
  /** how many parent recipes were repointed from the merged-away component */
  rewiredParents: number
}

/** Is `candidateId` reachable as a sub-recipe descendant of `rootId`? (cycle guard) */
async function isDescendant(rootId: string, candidateId: string): Promise<boolean> {
  const seen = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const children = await db.recipeLinks.where('parentId').equals(id).toArray()
    for (const l of children) {
      if (l.childId === candidateId) return true
      stack.push(l.childId)
    }
  }
  return false
}

/**
 * Merge component `fromId` into `toId`: every recipe that referenced `from` as a
 * sub-recipe is repointed to `to`, links are rebuilt, and `from` is deleted.
 * Use to fold a near-duplicate syrup ("Semi Rich Simple Syrup") into the one the
 * user wants to keep. Both must be components. Runs in one transaction.
 */
export async function mergeComponents(fromId: string, toId: string): Promise<MergeResult> {
  if (fromId === toId) return { rewiredParents: 0 }

  return db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    const from = await db.recipes.get(fromId)
    const to = await db.recipes.get(toId)
    if (!from || !to) throw new Error('Both components must exist to merge.')
    if (from.kind !== 'component' || to.kind !== 'component') {
      throw new Error('Only sub-recipe components can be merged.')
    }
    // Guard against creating a cycle: if `to` already sits under `from`, merging
    // would make the survivor reference itself through the rewired parents.
    if (await isDescendant(fromId, toId)) {
      throw new Error('Cannot merge a component into one of its own sub-recipes.')
    }

    const parentLinks = await db.recipeLinks.where('childId').equals(fromId).toArray()
    const parentIds = [...new Set(parentLinks.map((l) => l.parentId))]

    let rewiredParents = 0
    for (const pid of parentIds) {
      const parent = await db.recipes.get(pid)
      if (!parent) continue
      const ingredients = parent.ingredients.map((i) =>
        i.subRecipeId === fromId ? { ...i, subRecipeId: toId } : i,
      )
      await db.recipes.update(pid, { ingredients })
      // Rebuild this parent's links from its (now-repointed) ingredients.
      await db.recipeLinks.where('parentId').equals(pid).delete()
      await db.recipeLinks.bulkPut(linksForRecipe({ ...parent, ingredients }))
      rewiredParents++
    }

    // Drop the merged-away component and any of its own link rows.
    await db.recipes.delete(fromId)
    await db.recipeLinks.where('parentId').equals(fromId).delete()
    await db.recipeLinks.where('childId').equals(fromId).delete()

    return { rewiredParents }
  })
}
