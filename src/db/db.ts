import Dexie, { type Table } from 'dexie'
import type { Recipe, RecipeLink } from './schema'

export class CocktailDB extends Dexie {
  recipes!: Table<Recipe, string>
  recipeLinks!: Table<RecipeLink, string>

  constructor() {
    super('cocktailDB')
    // Only indexed fields are listed; full objects are stored regardless.
    // New/optional fields (e.g. `source`) live in the JSON blob and need no
    // schema bump — this is the "import drops in without migration" guarantee.
    this.version(1).stores({
      recipes: 'id, kind, name, spirit, updatedAt, *tags',
      recipeLinks: 'id, parentId, childId, [parentId+childId]',
    })
  }
}

export const db = new CocktailDB()
