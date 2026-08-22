// Core domain types. A cocktail, a syrup and a cordial are the SAME entity
// (`Recipe`), distinguished only by `kind`. Each is added/edited/imported the
// same way; recipes reference other recipes through an ingredient's `recipeId`,
// wired up by name-autocomplete in the editor rather than invented at import.

export type RecipeKind = 'cocktail' | 'syrup' | 'cordial'

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
  /** cross-link: if this ingredient IS another recipe (a syrup/cordial), its Recipe.id */
  recipeId?: string
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
 * A named bar/inventory. Users keep "My Bar" plus any others (a friend's place,
 * a travel kit). Exactly one is "active" at a time (tracked in localStorage).
 */
export interface Bar {
  id: string
  name: string
  createdAt: number
}

/**
 * One bottle/ingredient in a specific bar. `name` is the normalized match key,
 * unique *within a bar* — the store's primary key is the compound
 * `[barId+name]`. `label` keeps the nice casing the user saw when adding it.
 *
 * `category` and `brand` are optional and additive (no schema bump — see db.ts).
 * `category` is stored rather than re-inferred on every render, and stays
 * user-correctable: `categoryForName()` guesses well but not always, and a
 * wrong guess changes what the bottle substitutes for.
 */
export interface PantryItem {
  barId: string
  name: string
  label: string
  addedAt: number
  /** base-spirit family, inferred at write time or set by the user */
  category?: string
  /** producer alone ("Plantation"), when a scan or the user supplied one */
  brand?: string
}

/**
 * Denormalized many-to-many index of which recipe references which other recipe
 * (a cocktail pouring a syrup, say). Reconciled inside the save transaction from
 * each recipe's ingredients. Rebuildable from `recipes` alone — an index, not a
 * second source of truth.
 */
export interface RecipeLink {
  id: string
  parentId: string
  childId: string
  ingredientId: string
}
