import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { countUsage, deleteRecipe, importRecipe, saveRecipe } from './importRecipe'
import type { StructuredImport } from './types'

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
