import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import {
  countUsage,
  deleteRecipe,
  importRecipe,
  mergeComponents,
  saveRecipe,
} from './importRecipe'
import type { StructuredImport } from './types'

/** A cocktail that references a syrup by the given (component) name. */
function drinkWithSyrup(drink: string, syrup: string): StructuredImport {
  return {
    main: {
      tempId: drink.toLowerCase().replace(/\s+/g, '-'),
      kind: 'cocktail',
      name: drink,
      measureBasis: 'absolute',
      ingredients: [
        { name: 'Base spirit', amount: 2, unit: 'oz' },
        { name: syrup, amount: 0.75, unit: 'oz', subRecipeRef: 'syrup' },
      ],
    },
    components: [
      {
        tempId: 'syrup',
        kind: 'component',
        name: syrup,
        measureBasis: 'parts',
        ingredients: [
          { name: 'Sugar', amount: 1, unit: 'part' },
          { name: 'Water', amount: 1, unit: 'part' },
        ],
      },
    ],
  }
}

function drinkSharingSyrup(name: string): StructuredImport {
  return {
    main: {
      tempId: name.toLowerCase(),
      kind: 'cocktail',
      name,
      measureBasis: 'absolute',
      ingredients: [
        { name: 'Base spirit', amount: 2, unit: 'oz' },
        { name: 'Simple Syrup', amount: 0.75, unit: 'oz', subRecipeRef: 'syrup' },
      ],
    },
    components: [
      {
        tempId: 'syrup',
        kind: 'component',
        name: 'Simple Syrup',
        measureBasis: 'parts',
        ingredients: [
          { name: 'Sugar', amount: 1, unit: 'part' },
          { name: 'Water', amount: 1, unit: 'part' },
        ],
      },
    ],
  }
}

describe('importRecipe', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
  })

  it('inserts a main recipe and its component', async () => {
    const { mainId, componentIds } = await importRecipe(drinkSharingSyrup('Daiquiri'))
    expect(await db.recipes.get(mainId)).toBeTruthy()
    expect(componentIds).toHaveLength(1)

    const main = await db.recipes.get(mainId)
    const syrupIng = main!.ingredients.find((i) => i.name === 'Simple Syrup')
    expect(syrupIng?.subRecipeId).toBe(componentIds[0])
  })

  it('dedupes a shared component across two drinks (one record, two links)', async () => {
    const a = await importRecipe(drinkSharingSyrup('Daiquiri'))
    const b = await importRecipe(drinkSharingSyrup('Whiskey Sour'))

    // both drinks point at the SAME syrup record
    expect(a.componentIds[0]).toBe(b.componentIds[0])

    const components = await db.recipes.where('kind').equals('component').toArray()
    expect(components).toHaveLength(1)

    // back-links: the syrup is used in two cocktails
    const childId = a.componentIds[0]
    const backlinks = await db.recipeLinks.where('childId').equals(childId).toArray()
    expect(backlinks).toHaveLength(2)
    const parentIds = backlinks.map((l) => l.parentId).sort()
    expect(parentIds).toEqual([a.mainId, b.mainId].sort())
  })

  it('saveRecipe replaces link rows when ingredients change', async () => {
    const { mainId, componentIds } = await importRecipe(drinkSharingSyrup('Daiquiri'))
    const main = await db.recipes.get(mainId)
    // remove the syrup ingredient
    main!.ingredients = main!.ingredients.filter((i) => !i.subRecipeId)
    await saveRecipe(main!)

    const backlinks = await db.recipeLinks.where('childId').equals(componentIds[0]).toArray()
    expect(backlinks).toHaveLength(0)
  })

  it('deleting a shared syrup unlinks it from the cocktails that used it', async () => {
    const a = await importRecipe(drinkSharingSyrup('Daiquiri'))
    const b = await importRecipe(drinkSharingSyrup('Whiskey Sour'))
    const syrupId = a.componentIds[0]

    expect(await countUsage(syrupId)).toBe(2)
    await deleteRecipe(syrupId)

    // the component is gone, its links are gone
    expect(await db.recipes.get(syrupId)).toBeUndefined()
    expect(await db.recipeLinks.where('childId').equals(syrupId).count()).toBe(0)

    // the cocktails still have the ingredient, but no dangling subRecipeId
    for (const id of [a.mainId, b.mainId]) {
      const c = await db.recipes.get(id)
      const ing = c!.ingredients.find((i) => i.name === 'Simple Syrup')
      expect(ing).toBeTruthy()
      expect(ing!.subRecipeId).toBeUndefined()
    }
  })
})

describe('mergeComponents', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
  })

  it('repoints parents, deletes the merged-away component, rebuilds links', async () => {
    const daiq = await importRecipe(drinkWithSyrup('Daiquiri', 'Simple Syrup'))
    const oldf = await importRecipe(drinkWithSyrup('Old Fashioned', 'Rich Simple Syrup'))
    const simpleId = daiq.componentIds[0]
    const richId = oldf.componentIds[0]
    expect(simpleId).not.toBe(richId)

    const res = await mergeComponents(richId, simpleId)
    expect(res.rewiredParents).toBe(1)

    // the rich variant is gone
    expect(await db.recipes.get(richId)).toBeUndefined()
    // the old fashioned now points at the surviving syrup
    const of = await db.recipes.get(oldf.mainId)
    const ing = of!.ingredients.find((i) => i.subRecipeId)
    expect(ing!.subRecipeId).toBe(simpleId)
    // survivor is now used in both cocktails
    expect(await countUsage(simpleId)).toBe(2)
  })

  it('is a no-op when from === to', async () => {
    const daiq = await importRecipe(drinkWithSyrup('Daiquiri', 'Simple Syrup'))
    const id = daiq.componentIds[0]
    const res = await mergeComponents(id, id)
    expect(res.rewiredParents).toBe(0)
    expect(await db.recipes.get(id)).toBeTruthy()
  })

  it('throws when either id is not a component', async () => {
    const daiq = await importRecipe(drinkWithSyrup('Daiquiri', 'Simple Syrup'))
    const cocktailId = daiq.mainId
    const syrupId = daiq.componentIds[0]
    await expect(mergeComponents(cocktailId, syrupId)).rejects.toThrow()
  })

  it('collapses a parent that references both into one survivor', async () => {
    const imp: StructuredImport = {
      main: {
        tempId: 'm',
        kind: 'cocktail',
        name: 'Two Syrups',
        measureBasis: 'absolute',
        ingredients: [
          { name: 'Simple Syrup', amount: 1, unit: 'oz', subRecipeRef: 'a' },
          { name: 'Rich Syrup', amount: 1, unit: 'oz', subRecipeRef: 'b' },
        ],
      },
      components: [
        {
          tempId: 'a',
          kind: 'component',
          name: 'Simple Syrup',
          measureBasis: 'parts',
          ingredients: [{ name: 'Sugar', amount: 1, unit: 'part' }],
        },
        {
          tempId: 'b',
          kind: 'component',
          name: 'Rich Syrup',
          measureBasis: 'parts',
          ingredients: [{ name: 'Sugar', amount: 2, unit: 'part' }],
        },
      ],
    }
    const r = await importRecipe(imp)
    const [aId, bId] = r.componentIds

    await mergeComponents(bId, aId)

    const m = await db.recipes.get(r.mainId)
    expect(m!.ingredients).toHaveLength(2)
    expect(m!.ingredients.every((i) => i.subRecipeId === aId)).toBe(true)

    const links = await db.recipeLinks.where('parentId').equals(r.mainId).toArray()
    expect(links).toHaveLength(2)
    expect(links.every((l) => l.childId === aId)).toBe(true)
    expect(await db.recipes.get(bId)).toBeUndefined()
  })

  it('refuses to merge a component into its own sub-recipe (cycle guard)', async () => {
    const nested = await importRecipe({
      main: {
        tempId: 'compound',
        kind: 'component',
        name: 'Compound Syrup',
        measureBasis: 'parts',
        ingredients: [{ name: 'Sub Syrup', amount: 1, unit: 'part', subRecipeRef: 'sub' }],
      },
      components: [
        {
          tempId: 'sub',
          kind: 'component',
          name: 'Sub Syrup',
          measureBasis: 'parts',
          ingredients: [{ name: 'Sugar', amount: 1, unit: 'part' }],
        },
      ],
    })
    await expect(mergeComponents(nested.mainId, nested.componentIds[0])).rejects.toThrow(
      /sub-recipe/,
    )
  })
})
