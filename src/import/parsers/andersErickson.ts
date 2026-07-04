// The Anders Erickson import seam. His YouTube descriptions hold the main
// cocktail followed by labelled sub-recipe blocks (Simple Syrup, orgeat, …).
// Phase 2 implements this with a forgiving on-device text parser; the Import
// screen shows an editable preview so the user fixes anything before saving.
//
// `parseRecipeText` is general (works on any pasted recipe description); this
// module is the named entry point the app imports.
export { parseRecipeText as parseRecipe } from '../parseRecipeText'
export type { ParseResult } from '../parseRecipeText'
