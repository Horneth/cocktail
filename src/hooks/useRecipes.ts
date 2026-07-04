import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Recipe } from '../db/schema'

/** All cocktails, alphabetical. Components are excluded from the main list. */
export function useCocktails(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.where('kind').equals('cocktail').sortBy('name'), [])
}

/** All components (syrups etc.), alphabetical. */
export function useComponents(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.where('kind').equals('component').sortBy('name'), [])
}

/** A single recipe by id (undefined while loading, null if not found). */
export function useRecipe(id: string | undefined): Recipe | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return null
    return (await db.recipes.get(id)) ?? null
  }, [id])
}

/** Cocktails (or other recipes) that reference the given sub-recipe. */
export function useBacklinks(childId: string | undefined): Recipe[] | undefined {
  return useLiveQuery(async () => {
    if (!childId) return []
    const links = await db.recipeLinks.where('childId').equals(childId).toArray()
    const parentIds = [...new Set(links.map((l) => l.parentId))]
    const parents = await db.recipes.bulkGet(parentIds)
    return parents
      .filter((r): r is Recipe => !!r)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [childId])
}
