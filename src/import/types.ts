import type {
  MeasureBasis,
  RecipeKind,
  RecipeSource,
  SpiritCategory,
  Unit,
} from '../db/schema'

// The import seam. Every recipe source — seed data now, YouTube parsing in
// phase 2 — produces a `StructuredImport`, and `importRecipe()` writes it to
// the DB. Links between the main recipe and its components are expressed with
// local `tempId` references so a parser never needs to know real DB ids.

export interface IngredientDraft {
  name: string
  amount: number | null
  unit: Unit
  optional?: boolean
  note?: string
  /** matches a component draft's `tempId` when this ingredient is a sub-recipe */
  subRecipeRef?: string
}

export interface RecipeDraft {
  /** local-only id used to wire links before rows are inserted */
  tempId: string
  kind: RecipeKind
  name: string
  ingredients: IngredientDraft[]
  measureBasis: MeasureBasis
  baseServings?: number
  glassware?: string
  method?: string
  garnish?: string
  instructions?: string
  tags?: string[]
  spirit?: SpiritCategory
  notes?: string[]
  source?: RecipeSource
}

export interface StructuredImport {
  /** the primary recipe (usually a cocktail) */
  main: RecipeDraft
  /** sub-recipes referenced by the main recipe (syrups, cordials, …) */
  components: RecipeDraft[]
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}
