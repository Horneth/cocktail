import { importRecipe } from '../import/importRecipe'
import type { IngredientDraft, StructuredImport } from '../import/types'
import type { RecipeSource } from './schema'
import { genRefFor } from '../domain/imagePool'
import { db } from './db'

// Seed data authored as StructuredImport objects and written through the same
// importRecipe() path the YouTube importer uses — so the import seam is
// exercised from day one. Two mixers (Simple Syrup, Orgeat) are first-class
// syrup recipes; the cocktails that call for them reference them by id, so
// "Used in" back-links are populated immediately.
//
// Specs are real, sourced ones — IBA official recipes where the drink is one,
// Difford's Guide for the Manhattan, Wikipedia-cited standard specs for the
// two simple highballs. Provenance rides on each recipe's `source` field.
// Amounts are stored in oz rounded to the quarter step the UI nudges in, with
// the source's exact ml in a note where the rounding bites.

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

const orgeat: StructuredImport = {
  main: {
    tempId: 'orgeat',
    kind: 'syrup',
    name: 'Orgeat',
    measureBasis: 'parts',
    ingredients: [
      { name: 'Blanched almonds', amount: 1, unit: 'part' },
      { name: 'White sugar', amount: 1, unit: 'part' },
      { name: 'Water', amount: 1.5, unit: 'part' },
      { name: 'Orange flower water', amount: 1, unit: 'tsp', optional: true },
    ],
    instructions:
      'Blitz almonds with sugar, steep in hot water for 30 minutes, then strain through a fine cloth. Add orange flower water. Keeps ~2 weeks refrigerated.',
    tags: ['syrup'],
  },
}

/** Provenance for the seeded classics — each spec was taken from one of these. */
const source = {
  iba: (path: string): RecipeSource => ({ type: 'web', url: `https://iba-world.com${path}`, author: 'IBA' }),
  diffords: (path: string): RecipeSource => ({ type: 'web', url: `https://www.diffordsguide.com${path}`, author: "Difford's Guide" }),
  wikipedia: (path: string): RecipeSource => ({ type: 'web', url: `https://en.wikipedia.org${path}`, author: 'Wikipedia' }),
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

/** The mixers the classics cross-link to; seeded before them so ids resolve. */
export const MIXER_SEEDS: StructuredImport[] = [simpleSyrup, orgeat]

/**
 * The all-time classics, in the order the app ships them. Amounts in oz keep
 * the UI's quarter-step nudges exact; where the source spec is ml and doesn't
 * divide cleanly, the note carries the exact measure.
 */
export function classicSeeds(simpleSyrupId: string, orgeatId: string): StructuredImport[] {
  return [
    cocktail(
      'daiquiri',
      'Daiquiri',
      [
        { name: 'White rum', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        syrup(simpleSyrupId, 0.75),
      ],
      {
        method: 'Shake',
        glassware: 'Coupe',
        garnish: 'Lime wheel',
        spirit: 'rum',
        tags: ['sour', 'classic', 'citrusy'],
        image: genRefFor('Daiquiri'),
        instructions: 'Shake all with ice until well chilled. Double-strain into a chilled coupe.',
        source: source.iba('/cocktails/daiquiri/'),
      },
    ),
    cocktail(
      'whiskey-sour',
      'Whiskey Sour',
      [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        { name: 'Lemon juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed' },
        syrup(simpleSyrupId, 0.75),
        { name: 'Egg white', amount: 1, unit: 'each', optional: true },
        { name: 'Angostura bitters', amount: 2, unit: 'dash', optional: true },
      ],
      {
        method: 'Shake',
        glassware: 'Rocks',
        garnish: 'Lemon peel & cherry',
        spirit: 'whiskey',
        tags: ['sour', 'classic'],
        image: genRefFor('Whiskey Sour'),
        instructions:
          'Dry-shake (no ice) to emulsify the egg white, then shake with ice. Strain over fresh ice.',
        source: source.iba('/cocktails/whiskey-sour/'),
      },
    ),
    cocktail(
      'old-fashioned',
      'Old Fashioned',
      [
        { name: 'Bourbon', amount: 2, unit: 'oz' },
        syrup(simpleSyrupId, 0.25),
        { name: 'Angostura bitters', amount: 3, unit: 'dash' },
        { name: 'Orange peel', amount: null, unit: 'piece' },
      ],
      {
        method: 'Stir',
        glassware: 'Rocks',
        garnish: 'Orange peel',
        spirit: 'whiskey',
        tags: ['spirit-forward', 'classic'],
        image: genRefFor('Old Fashioned'),
        instructions:
          'Stir with ice until chilled and diluted. Strain over one large cube. Express the orange peel over the top.',
        source: source.iba('/cocktails/old-fashioned/'),
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
        image: genRefFor('Margarita'),
        instructions:
          'Shake all with ice. Strain over fresh ice into a glass with an optional salt rim.',
        source: source.iba('/cocktails/margarita/'),
      },
    ),
    // ── The ten all-time classics ────────────────────────────────────────────
    cocktail(
      'mojito',
      'Mojito',
      [
        { name: 'White rum', amount: 1.5, unit: 'oz' },
        { name: 'Lime juice', amount: 0.75, unit: 'oz', note: 'freshly squeezed (20 ml IBA)' },
        { name: 'White cane sugar', amount: 2, unit: 'tsp' },
        { name: 'Mint', amount: 6, unit: 'sprig' },
        { name: 'Soda water', amount: null, unit: 'oz', note: 'to top' },
      ],
      {
        method: 'Build',
        glassware: 'Highball',
        garnish: 'Mint sprig & lime slice',
        spirit: 'rum',
        tags: ['classic', 'refreshing', 'herbal', 'citrusy'],
        image: genRefFor('Mojito'),
        instructions:
          'Gently muddle the mint with sugar and lime juice. Add a splash of soda, fill with ice, pour the rum and top with soda. Light stir.',
        source: source.iba('/cocktails/mojito/'),
      },
    ),
    cocktail(
      'pina-colada',
      'Piña Colada',
      [
        { name: 'White rum', amount: 1.75, unit: 'oz', note: '50 ml IBA' },
        { name: 'Coconut cream', amount: 1, unit: 'oz', note: '30 ml IBA' },
        { name: 'Pineapple juice', amount: 1.75, unit: 'oz', note: '50 ml, fresh' },
      ],
      {
        method: 'Blend',
        glassware: 'Hurricane',
        garnish: 'Pineapple wedge & cherry',
        spirit: 'rum',
        tags: ['classic', 'tropical', 'creamy', 'fruity'],
        image: genRefFor('Piña Colada'),
        instructions:
          'Blend all the ingredients with ice. Pour into a large glass and serve with straws. A few drops of lime to taste, per the IBA note.',
        source: source.iba('/cocktails/pina-colada/'),
      },
    ),
    cocktail(
      'negroni',
      'Negroni',
      [
        { name: 'Gin', amount: 1, unit: 'oz' },
        { name: 'Campari', amount: 1, unit: 'oz' },
        { name: 'Sweet vermouth', amount: 1, unit: 'oz' },
      ],
      {
        method: 'Build',
        glassware: 'Rocks',
        garnish: 'Orange half-wheel',
        spirit: 'gin',
        tags: ['classic', 'spirit-forward', 'bitter'],
        image: genRefFor('Negroni'),
        instructions:
          'Pour all three into a chilled rocks glass over ice and stir gently.',
        source: source.iba('/cocktails/negroni/'),
      },
    ),
    cocktail(
      'dry-martini',
      'Dry Martini',
      [
        { name: 'Gin', amount: 2, unit: 'oz' },
        { name: 'Dry vermouth', amount: 2, unit: 'barspoon', note: '10 ml — a 6:1 Martini' },
      ],
      {
        method: 'Stir',
        glassware: 'Martini',
        garnish: 'Lemon peel (or olive on request)',
        spirit: 'gin',
        tags: ['classic', 'spirit-forward'],
        image: genRefFor('Dry Martini'),
        instructions:
          'Stir with ice until very cold. Strain into a chilled martini glass. Express lemon peel over the top, or garnish with a green olive if asked.',
        source: source.iba('/cocktails/dry-martini/'),
      },
    ),
    cocktail(
      'manhattan',
      'Manhattan',
      [
        { name: 'Bourbon', amount: 1.5, unit: 'oz' },
        { name: 'Rye whiskey', amount: 0.5, unit: 'oz' },
        { name: 'Sweet vermouth', amount: 1, unit: 'oz' },
        { name: 'Angostura bitters', amount: 1, unit: 'dash' },
      ],
      {
        method: 'Stir',
        glassware: 'Nick & Nora',
        garnish: 'Orange twist & cherry',
        spirit: 'whiskey',
        tags: ['classic', 'spirit-forward', 'nightcap'],
        image: genRefFor('Manhattan'),
        instructions:
          'Stir with ice until chilled. Fine-strain into a chilled glass; express the orange twist and discard.',
        source: source.diffords('/cocktails/recipe/1247/manhattan-cocktail-sweet'),
      },
    ),
    cocktail(
      'mai-tai',
      'Mai Tai',
      [
        { name: 'Amber Jamaican rum', amount: 1, unit: 'oz' },
        { name: 'Martinique rhum', amount: 1, unit: 'oz' },
        { name: 'Orange curaçao', amount: 0.5, unit: 'oz' },
        { name: 'Orgeat', amount: 0.5, unit: 'oz', recipeId: orgeatId },
        { name: 'Lime juice', amount: 1, unit: 'oz', note: 'freshly squeezed (30 ml IBA)' },
        syrup(simpleSyrupId, 0.25),
      ],
      {
        method: 'Shake',
        glassware: 'Rocks',
        garnish: 'Pineapple spear, mint sprig & lime peel',
        spirit: 'rum',
        tags: ['classic', 'tropical', 'tiki', 'citrusy'],
        image: genRefFor('Mai Tai'),
        instructions:
          'Shake everything with ice and pour into a double rocks glass. Trader Vic 1944: aged Jamaican rum, orange curaçao, orgeat, lime, rock-candy syrup.',
        source: source.iba('/cocktails/mai-tai/'),
      },
    ),
    cocktail(
      'moscow-mule',
      'Moscow Mule',
      [
        { name: 'Vodka', amount: 1.75, unit: 'oz', note: '50 ml' },
        { name: 'Lime juice', amount: 0.5, unit: 'oz', note: 'freshly squeezed' },
        { name: 'Ginger beer', amount: 4, unit: 'oz', note: '120 ml' },
      ],
      {
        method: 'Build',
        glassware: 'Mug',
        garnish: 'Lime wedge',
        spirit: 'vodka',
        tags: ['classic', 'refreshing', 'citrusy'],
        image: genRefFor('Moscow Mule'),
        instructions:
          'Build over ice in a copper mug and stir once. The 50 ml / 15 ml / 120 ml house spec is the one every source agrees on.',
        source: source.wikipedia('/wiki/Moscow_mule'),
      },
    ),
    cocktail(
      'aperol-spritz',
      'Aperol Spritz',
      [
        { name: 'Prosecco', amount: 3, unit: 'oz', note: '90 ml IBA' },
        { name: 'Aperol', amount: 2, unit: 'oz', note: '60 ml IBA' },
        { name: 'Soda water', amount: null, unit: 'oz', note: 'splash' },
      ],
      {
        method: 'Build',
        glassware: 'Wine',
        garnish: 'Orange slice',
        spirit: 'aperitivo',
        tags: ['classic', 'refreshing', 'bubbly', 'bitter', 'low-abv'],
        image: genRefFor('Aperol Spritz'),
        instructions:
          'Build into a wine glass over ice, prosecco first, then Aperol and a splash of soda. Stir gently. 3-2-1 with a splash.',
        source: source.iba('/iba-cocktail/spritz/'),
      },
    ),
    cocktail(
      'espresso-martini',
      'Espresso Martini',
      [
        { name: 'Vodka', amount: 1.75, unit: 'oz', note: '50 ml IBA' },
        { name: 'Kahlúa', amount: 1, unit: 'oz', note: '30 ml — or any coffee liqueur' },
        { name: 'Simple Syrup', amount: 2, unit: 'tsp', note: '10 ml', recipeId: simpleSyrupId },
        { name: 'Fresh espresso', amount: 1, unit: 'each', note: 'strong' },
      ],
      {
        method: 'Shake',
        glassware: 'Martini',
        garnish: '3 coffee beans',
        spirit: 'vodka',
        tags: ['classic', 'nightcap'],
        image: genRefFor('Espresso Martini'),
        instructions:
          'Shake hard with ice — the foam is the point — and strain into a chilled martini glass. Drop three beans on top.',
        source: source.iba('/cocktails/espresso-martini/'),
      },
    ),
    cocktail(
      'gin-and-tonic',
      'Gin & Tonic',
      [
        { name: 'Gin', amount: 1.75, unit: 'oz', note: '50 ml' },
        { name: 'Tonic water', amount: null, unit: 'oz', note: 'to top — 1 part gin to 3 parts tonic' },
        { name: 'Lime wedge', amount: 1, unit: 'wedge' },
      ],
      {
        method: 'Build',
        glassware: 'Highball',
        garnish: 'Lime wedge',
        spirit: 'gin',
        tags: ['classic', 'refreshing', 'bubbly'],
        image: genRefFor('Gin & Tonic'),
        instructions: 'Build over ice, top with tonic, squeeze the wedge in and drop it in the glass.',
        source: source.wikipedia('/wiki/Gin_and_tonic'),
      },
    ),
  ]
}

/**
 * Seeds any missing starter recipes, exactly once per install. Fresh stores
 * get the whole set; existing installs get the upgrade — and because the
 * one-time flag is set on success, a classic the user deleted afterwards
 * stays deleted. Per-name skips make a partial run (a failed import, a
 * crashed boot) resume where it stopped.
 */
export async function seedClassics(): Promise<void> {
  const FLAG = 'cocktail.seedClassics'
  if (localStorage.getItem(FLAG)) return

  const have = new Set((await db.recipes.toArray()).map((r) => r.name))

  // Mixers first: the cocktails cross-link them by id, and links only resolve
  // if the target already exists.
  let simpleSyrupId: string | undefined
  let orgeatId: string | undefined
  if (!have.has('Simple Syrup')) simpleSyrupId = await importRecipe(simpleSyrup)
  if (!have.has('Orgeat')) orgeatId = await importRecipe(orgeat)
  if (!simpleSyrupId || !orgeatId) {
    const rows = await db.recipes.toArray()
    simpleSyrupId ??= rows.find((r) => r.kind === 'syrup' && r.name === 'Simple Syrup')?.id
    orgeatId ??= rows.find((r) => r.kind === 'syrup' && r.name === 'Orgeat')?.id
  }
  if (!simpleSyrupId || !orgeatId) throw new Error('Seed mixers not found — cannot wire links')

  for (const seed of classicSeeds(simpleSyrupId, orgeatId)) {
    if (have.has(seed.main.name)) continue
    await importRecipe(seed)
  }
  localStorage.setItem(FLAG, '1')
}