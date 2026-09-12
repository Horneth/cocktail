import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Bar, PantryItem, Recipe } from '../db/schema'
import { KNOWN_SPIRITS } from '../domain/spirits'
import { isStaple, normIngredient, shelfKeys } from '../domain/availability'
import type { NameIndexEntry } from '../domain/dupeMatch'
import { useActiveBarId } from './useSettings'

/** All cocktails, alphabetical — the base for availability, bar insights and
 * the editor's linkable list. The Recipes screen itself shows everything. */
export function useCocktails(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.where('kind').equals('cocktail').sortBy('name'), [])
}

/** Every recipe — cocktails and syrups — alphabetical. The one list the
 * Recipes screen shows; a syrup is a recipe too. */
export function useAllRecipes(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.orderBy('name').toArray(), [])
}

/** All syrups (every mixer), alphabetical. */
export function useMixers(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.where('kind').equals('syrup').sortBy('name'), [])
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

/**
 * Just the id/name/kind of every recipe — the smallest slice the import screen
 * needs to look for duplicates locally before asking the AI about any of them.
 */
export function useRecipeNameIndex(): NameIndexEntry[] {
  return (
    useLiveQuery(async () => {
      const all = await db.recipes.toArray()
      return all.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))
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
  /** match keys currently in the bar — see `shelfKeys` */
  have: Set<string>
  loaded: boolean
}

/** A single bar's bottle inventory, reactive. Empty while `barId` is unresolved. */
export function usePantry(barId: string | undefined): Pantry {
  const items = useLiveQuery(
    () =>
      barId
        ? db.bottles.where('barId').equals(barId).sortBy('name')
        : Promise.resolve<PantryItem[]>([]),
    [barId],
  )
  const have = useMemo(() => new Set((items ?? []).flatMap(shelfKeys)), [items])
  return { items: items ?? [], have, loaded: !!barId && items !== undefined }
}

/** All bars, oldest first. */
export function useBars(): Bar[] | undefined {
  return useLiveQuery(() => db.bars.orderBy('createdAt').toArray(), [])
}

/**
 * Bottle count per bar id. `usePantry` only loads the active bar, so anything
 * listing every bar (the bar switcher, a delete confirmation) needs this rather
 * than inferring a count it can't see.
 */
export function useBottleCounts(): Map<string, number> {
  const counts = useLiveQuery(async () => {
    const out = new Map<string, number>()
    // Counting keys off the `barId` index avoids deserializing every bottle.
    await db.bottles.orderBy('barId').eachKey((barId) => {
      const id = String(barId)
      out.set(id, (out.get(id) ?? 0) + 1)
    })
    return out
  }, [])
  return counts ?? new Map()
}

export interface ActiveBar {
  /** the resolved active bar id (stored choice, or the first bar as fallback) */
  barId: string | undefined
  bars: Bar[]
  loaded: boolean
  setBarId: (id: string) => void
}

/**
 * Resolve the active bar: the user's stored choice if it still exists, else the
 * first bar. Degrades gracefully when the stored bar was deleted.
 */
export function useActiveBar(): ActiveBar {
  const bars = useBars()
  const [storedId, setBarId] = useActiveBarId()
  const list = bars ?? []
  const barId = list.find((b) => b.id === storedId)?.id ?? list[0]?.id
  return { barId, bars: list, loaded: bars !== undefined, setBarId }
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

/** Recipes that reference the given recipe. */
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
