import { NotImplementedError, type StructuredImport } from '../types'

/**
 * PHASE 2 SEAM — not implemented yet.
 *
 * Anders Erickson YouTube descriptions hold the main cocktail followed by
 * separate labelled ingredient blocks for sub-recipes, e.g.:
 *
 *   THE ELK'S OWN
 *   2 oz Rye Whiskey
 *   0.75 oz Ruby Port
 *   0.75 oz Lemon Juice
 *   0.5 oz Simple Syrup
 *   1 Egg White
 *
 *   SIMPLE SYRUP
 *   1 part sugar
 *   1 part water
 *
 * A future implementation will parse this text into a `StructuredImport`:
 * the first block becomes `main`, each subsequent labelled block becomes a
 * `component`, and ingredients whose name matches a component's title get a
 * `subRecipeRef` wired to that component's `tempId`. The result is handed to
 * `importRecipe()` — no schema or model change required.
 */
export function parseRecipe(_text: string): StructuredImport {
  throw new NotImplementedError(
    'YouTube recipe parsing is a phase-2 feature and is not implemented yet.',
  )
}
