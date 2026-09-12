import type {
  MeasureBasis,
  RecipeKind,
  RecipeSource,
  SpiritCategory,
  Unit,
} from '../db/schema'

// The import seam. Every recipe source — seed data now, YouTube parsing — writes
// one `StructuredImport` per recipe, and `importRecipe()` writes it to the DB.
// A recipe is a recipe, whatever its kind: the AI never invents sub-recipes or
// cross-links here. Linking an ingredient to another recipe happens later, in
// the editor, by name-autocomplete.

export interface IngredientDraft {
  name: string
  amount: number | null
  unit: Unit
  optional?: boolean
  note?: string
  /** a real Recipe.id, set when the author already knows the link (seed data) */
  recipeId?: string
}

export interface RecipeDraft {
  /** local-only id, used as a stable key within a preview batch */
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
  /** a JPEG/WebP data URL; absent means "generate from the recipe" on save */
  image?: string
}

/** Fields an AI import may fill in from knowledge rather than from the text. */
export type GuessedField = 'method' | 'glassware' | 'garnish' | 'tags' | 'spirit' | 'kind'

export const GUESSABLE_FIELDS: GuessedField[] = [
  'method',
  'glassware',
  'garnish',
  'tags',
  'spirit',
  'kind',
]

export interface StructuredImport {
  /** the recipe being imported (a cocktail or a syrup) */
  main: RecipeDraft
  /**
   * Preview-only. Which of `main`'s fields the model inferred rather than read,
   * so the review screen can mark them "✨ guessed". Deliberately a sibling of
   * `main` and not a `RecipeDraft` field: `draftToRecipe` is explicit-field so
   * it could never reach the DB anyway, and keeping it out here makes that
   * obvious to the next person adding a draft field.
   */
  guessed?: GuessedField[]
  /** Preview-only. Other names for this drink; feeds the local duplicate search. */
  aka?: string[]
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}
