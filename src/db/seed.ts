import { importRecipe } from '../import/importRecipe'
import type { IngredientDraft, StructuredImport } from '../import/types'
import { db } from './db'
import { seedImages } from './seedImages'

// Seed data authored as StructuredImport objects and written through the same
// importRecipe() path the YouTube importer uses — so the import seam is
// exercised from day one. Simple Syrup is a first-class syrup recipe; the
// Daiquiri, Whiskey Sour and Old Fashioned reference it by id, so its "Used in"
// back-links list is populated immediately.

const simpleSyrup: StructuredImport = {
  main: {
    tempId: 'simple-syrup',
    kind: 'syrup',
    name: 'Simple Syrup',
    measureBasis: 'parts',
    ingredients: [
      { name: 'White sugar', amount: 1, unit: 'part' },
      { name: 'Water', amount: 1, unit: 'part' },
    ],
    instructions:
      'Combine equal parts sugar and hot water; stir until fully dissolved. Cool before using. Keeps ~1 month refrigerated.',
    tags: ['syrup'],
  },
}

/** A cocktail, with the given ingredients. `syrupId` wires "Simple Syrup" to the syrup recipe. */
function cocktail(
  tempId: string,
  name: string,
  ingredients: IngredientDraft[],
  extra: Partial<StructuredImport['main']>,
): StructuredImport {
  return {
    main: {
      tempId,
      kind: 'cocktail',
      name,
      measureBasis: 'absolute',
      baseServings: 1,
      tags: [],
      ...extra,
      ingredients,
    },
  }
}

const syrup = (syrupId: string, amount: number): IngredientDraft => ({
  name: 'Simple Syrup',
  amount,
  unit: 'oz',
  recipeId: syrupId,
})

/** Populate the DB on first launch only (idempotent — guarded on empty store). */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.recipes.count()
  if (count > 0) return

  const syrupId = await importRecipe(simpleSyrup)

  const seeds: StructuredImport[] = [
    cocktail(
      'daiquiri',
      'Daiquiri',
      [
        { name: 'White rum', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        syrup(syrupId, 0.75),
      ],
      {
        method: 'Shake',
        glassware: 'Coupe',
        garnish: 'Lime wheel',
        spirit: 'rum',
        tags: ['sour', 'classic', 'citrusy'],
        image: seedImages.daiquiri,
        instructions: 'Shake all with ice until well chilled. Double-strain into a chilled coupe.',
      },
    ),
    cocktail(
      'whiskey-sour',
      'Whiskey Sour',
      [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        { name: 'Lemon juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        syrup(syrupId, 0.75),
        { name: 'Egg white', amount: 1, unit: 'each', optional: true },
        { name: 'Angostura bitters', amount: 2, unit: 'dash', optional: true },
      ],
      {
        method: 'Shake',
        glassware: 'Rocks',
        garnish: 'Lemon peel & cherry',
        spirit: 'whiskey',
        tags: ['sour', 'classic'],
        image: seedImages.whiskeysour,
        instructions:
          'Dry-shake (no ice) to emulsify the egg white, then shake with ice. Strain over fresh ice.',
      },
    ),
    cocktail(
      'old-fashioned',
      'Old Fashioned',
      [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        syrup(syrupId, 0.25),
        { name: 'Angostura bitters', amount: 3, unit: 'dash' },
        { name: 'Orange peel', amount: null, unit: 'piece' },
      ],
      {
        method: 'Stir',
        glassware: 'Rocks',
        garnish: 'Orange peel',
        spirit: 'whiskey',
        tags: ['spirit-forward', 'classic'],
        image: seedImages.oldfashioned,
        instructions:
          'Stir with ice until chilled and diluted. Strain over one large cube. Express the orange peel over the top.',
      },
    ),
    cocktail(
      'margarita',
      'Margarita',
      [
        { name: 'Blanco tequila', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 1, unit: 'oz', note: 'freshly squeezed' },
        { name: 'Orange liqueur', amount: 0.75, unit: 'oz', note: 'Cointreau or triple sec' },
        { name: 'Agave nectar', amount: 0.25, unit: 'oz', optional: true },
      ],
      {
        method: 'Shake',
        glassware: 'Rocks',
        garnish: 'Lime wheel & salt rim',
        spirit: 'tequila',
        tags: ['sour', 'classic', 'citrusy'],
        image: seedImages.margarita,
        instructions:
          'Shake all with ice. Strain over fresh ice into a glass with an optional salt rim.',
      },
    ),
  ]

  for (const s of seeds) {
    await importRecipe(s)
  }
}
