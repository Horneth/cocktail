import { db } from '../db/db'
import type { Ingredient, Recipe, RecipeLink } from '../db/schema'
import { newId } from '../domain/ids'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Writes one StructuredImport into the DB in a single transaction. An import is
// just a recipe — the AI never invents sub-recipes or cross-links, so there is
// no tempId wiring here: `draftToIngredient` copies any `recipeId` the author
// supplied (the seed data) straight through, and the links table is reconciled
// from the result.
//
// Used by seed data now and by the YouTube importer — the only shared write path
// into the recipe store.

function draftToIngredient(draft: IngredientDraft): Ingredient {
  const ing: Ingredient = {
    id: newId(),
    name: draft.name,
    amount: draft.amount,
    unit: draft.unit,
  }
  if (draft.optional !== undefined) ing.optional = draft.optional
  if (draft.note !== undefined) ing.note = draft.note
  if (draft.recipeId !== undefined) ing.recipeId = draft.recipeId
  return ing
}

function draftToRecipe(draft: RecipeDraft, now: number): Recipe {
  return {
    id: newId(),
    kind: draft.kind,
    name: draft.name,
    ingredients: draft.ingredients.map(draftToIngredient),
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
    image: draft.image,
    createdAt: now,
    updatedAt: now,
  }
}

function linksForRecipe(recipe: Recipe): RecipeLink[] {
  return recipe.ingredients
    .filter((i) => i.recipeId)
    .map((i) => ({
      id: newId(),
      parentId: recipe.id,
      childId: i.recipeId as string,
      ingredientId: i.id,
    }))
}

/** Insert one recipe and reconcile its cross-links. Returns the new recipe's id. */
export async function importRecipe(data: StructuredImport): Promise<string> {
  const recipe = draftToRecipe(data.main, Date.now())
  await db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    await db.recipes.put(recipe)
    await db.recipeLinks.bulkPut(linksForRecipe(recipe))
  })
  return recipe.id
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
 * Delete a recipe. If other recipes referenced it, those parents keep the
 * ingredient but lose the (now-dangling) link, so nothing points at a deleted
 * record.
 */
export async function deleteRecipe(recipeId: string): Promise<void> {
  await db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    // strip the dangling recipeId from any parent that referenced this recipe
    const parentLinks = await db.recipeLinks.where('childId').equals(recipeId).toArray()
    for (const pid of [...new Set(parentLinks.map((l) => l.parentId))]) {
      const parent = await db.recipes.get(pid)
      if (!parent) continue
      let changed = false
      const ingredients = parent.ingredients.map((i) => {
        if (i.recipeId === recipeId) {
          changed = true
          const copy = { ...i }
          delete copy.recipeId
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

/** How many recipes reference this one. */
export async function countUsage(recipeId: string): Promise<number> {
  const links = await db.recipeLinks.where('childId').equals(recipeId).toArray()
  return new Set(links.map((l) => l.parentId)).size
}

export interface MergeResult {
  /** how many parent recipes were repointed from the merged-away recipe */
  rewiredParents: number
}

/** Is `candidateId` reachable as a descendant of `rootId`? (cycle guard) */
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
 * Merge recipe `fromId` into `toId`: every recipe that referenced `from` is
 * repointed to `to`, links are rebuilt, and `from` is deleted. Use to fold a
 * near-duplicate mixer ("Semi Rich Simple Syrup") into the one the user wants to
 * keep. Both must be mixers of the same kind. Runs in one transaction.
 */
export async function mergeRecipes(fromId: string, toId: string): Promise<MergeResult> {
  if (fromId === toId) return { rewiredParents: 0 }

  return db.transaction('rw', db.recipes, db.recipeLinks, async () => {
    const from = await db.recipes.get(fromId)
    const to = await db.recipes.get(toId)
    if (!from || !to) throw new Error('Both recipes must exist to merge.')
    if (from.kind === 'cocktail' || to.kind === 'cocktail') {
      throw new Error('Only syrups and cordials can be merged.')
    }
    if (from.kind !== to.kind) {
      throw new Error('Only recipes of the same kind can be merged.')
    }
    // Guard against creating a cycle: if `to` already sits under `from`, merging
    // would make the survivor reference itself through the rewired parents.
    if (await isDescendant(fromId, toId)) {
      throw new Error('Cannot merge a recipe into one of its own ingredients.')
    }

    const parentLinks = await db.recipeLinks.where('childId').equals(fromId).toArray()
    const parentIds = [...new Set(parentLinks.map((l) => l.parentId))]

    let rewiredParents = 0
    for (const pid of parentIds) {
      const parent = await db.recipes.get(pid)
      if (!parent) continue
      const ingredients = parent.ingredients.map((i) =>
        i.recipeId === fromId ? { ...i, recipeId: toId } : i,
      )
      await db.recipes.update(pid, { ingredients })
      // Rebuild this parent's links from its (now-repointed) ingredients.
      await db.recipeLinks.where('parentId').equals(pid).delete()
      await db.recipeLinks.bulkPut(linksForRecipe({ ...parent, ingredients }))
      rewiredParents++
    }

    // Drop the merged-away recipe and any of its own link rows.
    await db.recipes.delete(fromId)
    await db.recipeLinks.where('parentId').equals(fromId).delete()
    await db.recipeLinks.where('childId').equals(fromId).delete()

    return { rewiredParents }
  })
}
