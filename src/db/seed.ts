import { importRecipe } from '../import/importRecipe'
import type { StructuredImport } from '../import/types'
import { db } from './db'

// Seed data authored as StructuredImport objects and written through the same
// importRecipe() path the (future) YouTube importer will use — so the import
// seam is exercised from day one. Simple Syrup is a shared component: the
// Daiquiri, Whiskey Sour and Old Fashioned all reference the same record, so
// its "Used in" back-links list is populated immediately.

const simpleSyrup: StructuredImport['components'][number] = {
  tempId: 'simple-syrup',
  kind: 'component',
  name: 'Simple Syrup',
  measureBasis: 'parts',
  ingredients: [
    { name: 'White sugar', amount: 1, unit: 'part' },
    { name: 'Water', amount: 1, unit: 'part' },
  ],
  instructions:
    'Combine equal parts sugar and hot water; stir until fully dissolved. Cool before using. Keeps ~1 month refrigerated.',
  tags: ['syrup'],
}

const seeds: StructuredImport[] = [
  {
    main: {
      tempId: 'daiquiri',
      kind: 'cocktail',
      name: 'Daiquiri',
      measureBasis: 'absolute',
      baseServings: 1,
      method: 'Shake',
      glassware: 'Coupe',
      garnish: 'Lime wheel',
      spirit: 'rum',
      tags: ['sour', 'classic', 'citrusy'],
      instructions: 'Shake all with ice until well chilled. Double-strain into a chilled coupe.',
      ingredients: [
        { name: 'White rum', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        { name: 'Simple Syrup', amount: 0.75, unit: 'oz', subRecipeRef: 'simple-syrup' },
      ],
    },
    components: [simpleSyrup],
  },
  {
    main: {
      tempId: 'whiskey-sour',
      kind: 'cocktail',
      name: 'Whiskey Sour',
      measureBasis: 'absolute',
      baseServings: 1,
      method: 'Shake',
      glassware: 'Rocks',
      garnish: 'Lemon peel & cherry',
      spirit: 'whiskey',
      tags: ['sour', 'classic'],
      instructions:
        'Dry-shake (no ice) to emulsify the egg white, then shake with ice. Strain over fresh ice.',
      ingredients: [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        { name: 'Lemon juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        { name: 'Simple Syrup', amount: 0.75, unit: 'oz', subRecipeRef: 'simple-syrup' },
        { name: 'Egg white', amount: 1, unit: 'each', optional: true },
        { name: 'Angostura bitters', amount: 2, unit: 'dash', optional: true },
      ],
    },
    components: [simpleSyrup],
  },
  {
    main: {
      tempId: 'old-fashioned',
      kind: 'cocktail',
      name: 'Old Fashioned',
      measureBasis: 'absolute',
      baseServings: 1,
      method: 'Stir',
      glassware: 'Rocks',
      garnish: 'Orange peel',
      spirit: 'whiskey',
      tags: ['spirit-forward', 'classic'],
      instructions:
        'Stir with ice until chilled and diluted. Strain over one large cube. Express the orange peel over the top.',
      ingredients: [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        { name: 'Simple Syrup', amount: 0.25, unit: 'oz', subRecipeRef: 'simple-syrup' },
        { name: 'Angostura bitters', amount: 3, unit: 'dash' },
        { name: 'Orange peel', amount: null, unit: 'piece' },
      ],
    },
    components: [simpleSyrup],
  },
  {
    main: {
      tempId: 'margarita',
      kind: 'cocktail',
      name: 'Margarita',
      measureBasis: 'absolute',
      baseServings: 1,
      method: 'Shake',
      glassware: 'Rocks',
      garnish: 'Lime wheel & salt rim',
      spirit: 'tequila',
      tags: ['sour', 'classic', 'citrusy'],
      instructions:
        'Shake all with ice. Strain over fresh ice into a glass with an optional salt rim.',
      ingredients: [
        { name: 'Blanco tequila', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 1, unit: 'oz', note: 'freshly squeezed' },
        { name: 'Orange liqueur', amount: 0.75, unit: 'oz', note: 'Cointreau or triple sec' },
        { name: 'Agave nectar', amount: 0.25, unit: 'oz', optional: true },
      ],
    },
    components: [],
  },
]

/** Populate the DB on first launch only (idempotent — guarded on empty store). */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.recipes.count()
  if (count > 0) return
  for (const s of seeds) {
    await importRecipe(s)
  }
}
