import Dexie, { type Table } from 'dexie'
import { newId } from '../domain/ids'
import type { Bar, PantryItem, Recipe, RecipeLink } from './schema'

export class CocktailDB extends Dexie {
  recipes!: Table<Recipe, string>
  recipeLinks!: Table<RecipeLink, string>
  bars!: Table<Bar, string>
  // Bottles are scoped to a bar via the compound key [barId+name].
  bottles!: Table<PantryItem, [string, string]>

  constructor() {
    super('cocktailDB')
    // Only indexed fields are listed; full objects are stored regardless.
    // New/optional fields (e.g. `source`) live in the JSON blob and need no
    // schema bump — this is the "import drops in without migration" guarantee.
    this.version(1).stores({
      recipes: 'id, kind, name, spirit, updatedAt, *tags',
      recipeLinks: 'id, parentId, childId, [parentId+childId]',
    })
    // v2 added the single-bar "My Bar" inventory (store `pantry`, keyed on the
    // bare normalized name).
    this.version(2).stores({
      pantry: 'name, addedAt',
    })
    // v3 introduces MULTIPLE bars. A bottle can now live in several bars, so the
    // key becomes compound `[barId+name]` — IndexedDB can't re-key a store in
    // place, so we migrate into a NEW `bottles` store and leave the old `pantry`
    // store untouched (harmless dead data). Existing bottles fold into a default
    // "My Bar"; fresh installs get their default bar from ensureDefaultBar().
    this.version(3)
      .stores({
        bars: 'id, name, createdAt',
        bottles: '[barId+name], barId, name, addedAt',
      })
      .upgrade(async (tx) => {
        const bar: Bar = { id: newId(), name: 'My Bar', createdAt: Date.now() }
        await tx.table('bars').add(bar)
        const old = await tx.table('pantry').toArray()
        if (old.length) {
          await tx.table('bottles').bulkAdd(old.map((r) => ({ ...r, barId: bar.id })))
        }
      })
  }
}

export const db = new CocktailDB()
