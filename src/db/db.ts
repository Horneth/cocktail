import Dexie, { type Table } from 'dexie'
import type { PantryItem, Recipe, RecipeLink } from './schema'

export class CocktailDB extends Dexie {
  recipes!: Table<Recipe, string>
  recipeLinks!: Table<RecipeLink, string>
  pantry!: Table<PantryItem, string>

  constructor() {
    super('cocktailDB')
    // Only indexed fields are listed; full objects are stored regardless.
    // New/optional fields (e.g. `source`) live in the JSON blob and need no
    // schema bump — this is the "import drops in without migration" guarantee.
    this.version(1).stores({
      recipes: 'id, kind, name, spirit, updatedAt, *tags',
      recipeLinks: 'id, parentId, childId, [parentId+childId]',
    })
    // v2 adds the "My Bar" inventory. Adding a store is a non-destructive
    // upgrade — existing recipes/links are preserved untouched.
    this.version(2).stores({
      pantry: 'name, addedAt',
    })
  }
}

export const db = new CocktailDB()
