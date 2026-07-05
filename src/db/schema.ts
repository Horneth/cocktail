// Core domain types. A cocktail and a syrup are the SAME entity (`Recipe`),
// distinguished by `kind`. This lets sub-recipes nest, reuses the edit screen,
// and lets the (future) importer write a homogeneous list of recipes + links.

export type RecipeKind = 'cocktail' | 'component' // component = syrup/cordial/orgeat/infusion

export type Unit =
  // volume (convertible)
  | 'oz'
  | 'ml'
  | 'cl'
  | 'dash'
  | 'drop'
  | 'barspoon'
  | 'tsp'
  | 'tbsp'
  // ratio
  | 'part'
  // countable / garnish / catch-alls (non-convertible)
  | 'piece'
  | 'wedge'
  | 'slice'
  | 'sprig'
  | 'leaf'
  | 'pinch'
  | 'top'
  | 'rinse'
  | 'each'
  | 'g'

export type MeasureBasis = 'absolute' | 'parts'

// Free-form so users can add any base spirit (cachaça, pisco, sake, …).
// The app ships metadata for a set of "known" spirits (see domain/spirits.ts);
// anything else is treated as a custom spirit with generated tile art.
// 'none' is a sentinel meaning "no base spirit" (e.g. a component).
export type SpiritCategory = string

export interface Ingredient {
  /** stable within the recipe, so notes/edits/links survive reordering */
  id: string
  name: string
  /** ORIGINAL amount, never mutated by view-time scaling. null = "to taste"/garnish */
  amount: number | null
  unit: Unit
  optional?: boolean
  note?: string
  /** cross-link: if this ingredient IS a sub-recipe, point at its Recipe.id (kind==='component') */
  subRecipeId?: string
}

export interface Note {
  id: string
  text: string
  createdAt: number
}

export interface RecipeSource {
  type: 'manual' | 'youtube' | 'web' | 'book'
  url?: string
  channel?: string
  videoId?: string
  author?: string
  importedAt?: number
}

export interface Recipe {
  id: string
  kind: RecipeKind
  name: string
  ingredients: Ingredient[]

  /** how ingredient amounts are interpreted */
  measureBasis: MeasureBasis
  /** for absolute recipes: how many servings the stored amounts describe */
  baseServings: number

  glassware?: string
  method?: string // Shake / Stir / Build / Blend
  garnish?: string
  instructions?: string

  tags: string[]
  spirit?: SpiritCategory

  /** pinned to the top of the list and filterable */
  favorite?: boolean

  notes: Note[]

  /** provenance — all optional, unused in phase 1, no migration needed to fill later */
  source?: RecipeSource

  createdAt: number
  updatedAt: number
}

/**
 * Denormalized many-to-many index of which recipe references which sub-recipe.
 * Reconciled inside the save transaction from each recipe's ingredients.
 * Rebuildable from `recipes` alone — an index, not a second source of truth.
 */
export interface RecipeLink {
  id: string
  parentId: string
  childId: string
  ingredientId: string
}
