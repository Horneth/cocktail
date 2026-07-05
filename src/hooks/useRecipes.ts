import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { PantryItem, Recipe } from '../db/schema'
import { KNOWN_SPIRITS } from '../domain/spirits'
import { isStaple, normIngredient } from '../domain/availability'

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

/** Distinct ingredient names seen across all recipes, for autocomplete. */
export function useKnownIngredients(): string[] {
  return (
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      const set = new Set<string>()
      for (const r of all) {
        for (const ing of r.ingredients) {
          const n = ing.name.trim()
          if (n) set.add(n)
        }
      }
      return [...set].sort((a, b) => a.localeCompare(b))
    }, []) ?? []
  )
}

/** Known + previously-used spirit names, for the spirit input's suggestions. */
export function useSpiritSuggestions(): string[] {
  return (
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      const set = new Set<string>(KNOWN_SPIRITS)
      for (const r of all) {
        const s = r.spirit?.trim().toLowerCase()
        if (s && s !== 'none') set.add(s)
      }
      return [...set].sort()
    }, []) ?? KNOWN_SPIRITS
  )
}

export interface Pantry {
  items: PantryItem[]
  /** normalized names currently in the bar */
  have: Set<string>
  loaded: boolean
}

/** The user's "My Bar" inventory, reactive. */
export function usePantry(): Pantry {
  const items = useLiveQuery(() => db.pantry.orderBy('name').toArray(), [])
  const have = useMemo(() => new Set((items ?? []).map((i) => i.name)), [items])
  return { items: items ?? [], have, loaded: items !== undefined }
}

export interface CatalogItem {
  name: string
  label: string
}

/**
 * Distinct "bottle-like" ingredients seen across all recipes, for the My Bar
 * picker — assumed staples (water, citrus, sugar, garnishes…) are excluded
 * since those are covered by the "assume basics" switch.
 */
export function useIngredientCatalog(): CatalogItem[] {
  return (
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      const byName = new Map<string, string>()
      for (const r of all) {
        for (const ing of r.ingredients ?? []) {
          const name = normIngredient(ing.name)
          if (!name || isStaple(name) || byName.has(name)) continue
          byName.set(name, ing.name.trim())
        }
      }
      return [...byName.entries()]
        .map(([name, label]) => ({ name, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
    }, []) ?? []
  )
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
