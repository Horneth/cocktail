import type { Recipe } from '../db/schema'
import { countUsage, deleteRecipe } from '../import/importRecipe'

/**
 * Delete a recipe, confirming first if it's a syrup/cordial still used by
 * other recipes (which then keep it as a plain ingredient).
 */
export async function deleteRecipeWithConfirm(r: Recipe): Promise<void> {
  if (r.kind !== 'cocktail') {
    const uses = await countUsage(r.id)
    if (
      uses > 0 &&
      !confirm(
        `“${r.name}” is used in ${uses} recipe${uses > 1 ? 's' : ''}. Delete it? They'll keep it as a plain ingredient.`,
      )
    ) {
      return
    }
  }
  await deleteRecipe(r.id)
}
