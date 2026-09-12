import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { attachGeneratedImage, countUsage, deleteRecipe, importRecipe, markImageFailed, mergeRecipes, saveRecipe } from './importRecipe'
import type { StructuredImport } from './types'

/** A syrup, imported as its own recipe. */
function syrup(name: string, tempId = 'syrup'): StructuredImport {
  return {
    main: {
      tempId,
      kind: 'syrup',
      name,
      measureBasis: 'parts',
      ingredients: [
        { name: 'Sugar', amount: 1, unit: 'part' },
        { name: 'Water', amount: 1, unit: 'part' },
      ],
    },
  }
}

/** A cocktail whose "Simple Syrup" line is linked to `syrupId`. */
function cocktail(name: string, syrupId: string): StructuredImport {
  return {
    main: {
      tempId: name.toLowerCase().replace(/\s+/g, '-'),
      kind: 'cocktail',
      name,
      measureBasis: 'absolute',
      ingredients: [
        { name: 'Base spirit', amount: 2, unit: 'oz' },
        { name: 'Simple Syrup', amount: 0.75, unit: 'oz', recipeId: syrupId },
      ],
    },
  }
}

describe('importRecipe', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
  })

  it('inserts a single recipe and returns its id', async () => {
    const id = await importRecipe(syrup('Simple Syrup'))
    const recipe = await db.recipes.get(id)
    expect(recipe).toBeTruthy()
    expect(recipe!.kind).toBe('syrup')
  })

  it('writes a cross-link when an ingredient already carries a recipeId', async () => {
    const syrupId = await importRecipe(syrup('Simple Syrup'))
    const drinkId = await importRecipe(cocktail('Daiquiri', syrupId))

    const links = await db.recipeLinks.toArray()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ parentId: drinkId, childId: syrupId })

    const drink = await db.recipes.get(drinkId)
    expect(drink!.ingredients.find((i) => i.name === 'Simple Syrup')!.recipeId).toBe(syrupId)
  })

  it('imports a cocktail without inventing any linked recipes', async () => {
    const id = await importRecipe({
      main: {
        tempId: 'daiquiri',
        kind: 'cocktail',
        name: 'Daiquiri',
        measureBasis: 'absolute',
        ingredients: [
          { name: 'White rum', amount: 2, unit: 'oz' },
          { name: 'Simple Syrup', amount: 0.75, unit: 'oz' },
        ],
      },
    })
    // one recipe, no links — "Simple Syrup" stays a plain ingredient name.
    expect(await db.recipes.count()).toBe(1)
    expect(await db.recipeLinks.count()).toBe(0)
    const drink = await db.recipes.get(id)
    expect(drink!.ingredients.every((i) => i.recipeId === undefined)).toBe(true)
  })

  it('saveRecipe replaces link rows when ingredients change', async () => {
    const syrupId = await importRecipe(syrup('Simple Syrup'))
    const drinkId = await importRecipe(cocktail('Daiquiri', syrupId))
    const drink = (await db.recipes.get(drinkId))!
    // unlink the syrup ingredient
    drink.ingredients = drink.ingredients.map((i) => (i.recipeId ? { ...i, recipeId: undefined } : i))
    await saveRecipe(drink)

    expect(await db.recipeLinks.where('childId').equals(syrupId).count()).toBe(0)
  })

  it('deleting a referenced syrup unlinks it from the cocktails that used it', async () => {
    const syrupId = await importRecipe(syrup('Simple Syrup'))
    const a = await importRecipe(cocktail('Daiquiri', syrupId))
    const b = await importRecipe(cocktail('Whiskey Sour', syrupId))

    expect(await countUsage(syrupId)).toBe(2)
    await deleteRecipe(syrupId)

    // the syrup is gone, its links are gone
    expect(await db.recipes.get(syrupId)).toBeUndefined()
    expect(await db.recipeLinks.where('childId').equals(syrupId).count()).toBe(0)

    // the cocktails still have the ingredient, but no dangling recipeId
    for (const id of [a, b]) {
      const c = await db.recipes.get(id)
      const ing = c!.ingredients.find((i) => i.name === 'Simple Syrup')
      expect(ing).toBeTruthy()
      expect(ing!.recipeId).toBeUndefined()
    }
  })
})

describe('mergeRecipes', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
  })

  it('repoints parents, deletes the merged-away recipe, rebuilds links', async () => {
    const simpleId = await importRecipe(syrup('Simple Syrup'))
    const richId = await importRecipe(syrup('Rich Simple Syrup', 'rich'))
    expect(simpleId).not.toBe(richId)

    const daiq = await importRecipe(cocktail('Daiquiri', simpleId))
    const oldf = await importRecipe(cocktail('Old Fashioned', richId))

    const res = await mergeRecipes(richId, simpleId)
    expect(res.rewiredParents).toBe(1)

    // the rich variant is gone
    expect(await db.recipes.get(richId)).toBeUndefined()
    // the old fashioned now points at the surviving syrup
    const of = await db.recipes.get(oldf)
    expect(of!.ingredients.find((i) => i.recipeId)!.recipeId).toBe(simpleId)
    // survivor is now used in both cocktails
    expect(await countUsage(simpleId)).toBe(2)
    expect(await db.recipes.get(daiq)).toBeTruthy()
  })

  it('is a no-op when from === to', async () => {
    const id = await importRecipe(syrup('Simple Syrup'))
    const res = await mergeRecipes(id, id)
    expect(res.rewiredParents).toBe(0)
    expect(await db.recipes.get(id)).toBeTruthy()
  })

  it('throws when either id is a cocktail', async () => {
    const syrupId = await importRecipe(syrup('Simple Syrup'))
    const drinkId = await importRecipe(cocktail('Daiquiri', syrupId))
    await expect(mergeRecipes(drinkId, syrupId)).rejects.toThrow()
  })

  it('collapses a parent that references both into one survivor', async () => {
    const aId = await importRecipe(syrup('Simple Syrup'))
    const bId = await importRecipe(syrup('Rich Syrup', 'rich'))
    const both: StructuredImport = {
      main: {
        tempId: 'm',
        kind: 'cocktail',
        name: 'Two Syrups',
        measureBasis: 'absolute',
        ingredients: [
          { name: 'Simple Syrup', amount: 1, unit: 'oz', recipeId: aId },
          { name: 'Rich Syrup', amount: 1, unit: 'oz', recipeId: bId },
        ],
      },
    }
    const drinkId = await importRecipe(both)

    await mergeRecipes(bId, aId)

    const m = await db.recipes.get(drinkId)
    expect(m!.ingredients).toHaveLength(2)
    expect(m!.ingredients.every((i) => i.recipeId === aId)).toBe(true)

    const links = await db.recipeLinks.where('parentId').equals(drinkId).toArray()
    expect(links).toHaveLength(2)
    expect(links.every((l) => l.childId === aId)).toBe(true)
    expect(await db.recipes.get(bId)).toBeUndefined()
  })

  it('refuses to merge a recipe into one of its own ingredients (cycle guard)', async () => {
    // A "Compound Syrup" that references a "Sub Syrup" — merging the parent into
    // the child would make the survivor reference itself.
    const subId = await importRecipe(syrup('Sub Syrup', 'sub'))
    const compoundId = await importRecipe({
      main: {
        tempId: 'compound',
        kind: 'syrup',
        name: 'Compound Syrup',
        measureBasis: 'parts',
        ingredients: [{ name: 'Sub Syrup', amount: 1, unit: 'part', recipeId: subId }],
      },
    })
    await expect(mergeRecipes(compoundId, subId)).rejects.toThrow(/ingredient/)
  })
})

describe('attachGeneratedImage / markImageFailed', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
  })

  it('attaches a pool reference and clears the pending guard', async () => {
    const id = await importRecipe(cocktail('Paper Plane', 'syrup'))
    await saveRecipe({ ...(await db.recipes.get(id))!, imageStatus: 'pending' })

    await attachGeneratedImage(id, 'gen:paper-plane')

    const saved = await db.recipes.get(id)
    expect(saved!.image).toBe('gen:paper-plane')
    expect(saved!.imageStatus).toBe('done')
  })

  it('never overwrites a photo the user chose while generation was in flight', async () => {
    const id = await importRecipe(cocktail('Paper Plane', 'syrup'))
    await saveRecipe({ ...(await db.recipes.get(id))!, image: 'data:image/webp;base64,QUJD' })

    await attachGeneratedImage(id, 'gen:paper-plane')

    expect((await db.recipes.get(id))!.image).toBe('data:image/webp;base64,QUJD')
  })

  it('does not attach after the user removed the pending request', async () => {
    const id = await importRecipe(cocktail('Paper Plane', 'syrup'))
    await saveRecipe({ ...(await db.recipes.get(id))!, imageStatus: 'pending' })
    await db.recipes.update(id, { imageStatus: 'none' })

    await attachGeneratedImage(id, 'gen:paper-plane')

    const saved = await db.recipes.get(id)
    expect(saved!.image).toBeUndefined()
    expect(saved!.imageStatus).toBe('none')
  })

  it('refuses a value that is not a pool reference', async () => {
    const id = await importRecipe(cocktail('Paper Plane', 'syrup'))
    await expect(attachGeneratedImage(id, 'https://example.com/x.webp')).rejects.toThrow(/pool/)
  })

  it('records failure without touching the image field', async () => {
    const id = await importRecipe(cocktail('Paper Plane', 'syrup'))
    await markImageFailed(id)
    const saved = await db.recipes.get(id)
    expect(saved!.imageStatus).toBe('failed')
    expect(saved!.image).toBeUndefined()
  })
})
