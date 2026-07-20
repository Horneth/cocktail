import { describe, expect, it } from 'vitest'
import {
  INGREDIENT_SCHEMA,
  RESPONSE_SCHEMA,
  finishParse,
  mapAiRecipe,
  namespaceTempIds,
  toJsonSchema,
  type AiRecipe,
} from './aiShared'

describe('toJsonSchema', () => {
  it('turns a nullable field into a union type, leaving everything else identity', () => {
    const js = toJsonSchema(INGREDIENT_SCHEMA)
    const props = js.properties as Record<string, { type: unknown }>
    // { type: 'number', nullable: true } -> { type: ['number', 'null'] }
    expect(props.amount.type).toEqual(['number', 'null'])
    // non-nullable fields keep a plain string type
    expect(props.name.type).toBe('string')
    expect(js.required).toEqual(['name', 'unit'])
    expect(js.type).toBe('object')
  })

  it('recurses into array items and nested objects', () => {
    const js = toJsonSchema(RESPONSE_SCHEMA)
    const recipes = (js.properties as Record<string, { items?: { type?: unknown } }>).recipes
    expect(recipes.items?.type).toBe('object')
    // a deep nullable (recipes[].ingredients[].amount) is still converted
    const recipeItems = recipes.items as { properties: Record<string, { items?: { properties?: Record<string, { type?: unknown }> } }> }
    const ingItems = recipeItems.properties.ingredients.items
    expect(ingItems?.properties?.amount.type).toEqual(['number', 'null'])
  })

  it('does not mutate the source schema', () => {
    const before = JSON.stringify(INGREDIENT_SCHEMA)
    toJsonSchema(INGREDIENT_SCHEMA)
    expect(JSON.stringify(INGREDIENT_SCHEMA)).toBe(before)
  })
})

describe('namespaceTempIds', () => {
  it('prefixes tempIds and rewrites matching subRecipeRefs per batch index', () => {
    const imp = mapAiRecipe({
      name: 'Mai Tai',
      ingredients: [{ name: 'Orgeat', unit: 'oz', amount: 0.5 }],
      subRecipes: [{ name: 'Orgeat', ingredients: [{ name: 'almond', unit: 'part', amount: 1 }] }],
    })
    const ref = imp.main.ingredients[0].subRecipeRef
    expect(ref).toBe(imp.components[0].tempId) // linked before namespacing

    const ns = namespaceTempIds(imp, 2)
    expect(ns.main.tempId).toMatch(/^r2\./)
    expect(ns.components[0].tempId).toMatch(/^r2\./)
    // the ingredient's ref is rewritten to still point at the renamed component
    expect(ns.main.ingredients[0].subRecipeRef).toBe(ns.components[0].tempId)
  })
})

describe('finishParse', () => {
  const RECIPE: AiRecipe = {
    name: 'Daiquiri',
    ingredients: [
      { name: 'White rum', unit: 'oz', amount: 2 },
      { name: 'Lime juice', unit: 'oz', amount: 0.75 },
    ],
  }

  it('accepts the multi-recipe { recipes: [...] } shape', () => {
    const out = finishParse({ recipes: [RECIPE, RECIPE] }, 'some text')
    expect(out).toHaveLength(2)
    // tempIds namespaced distinctly across the batch
    expect(out[0].main.tempId).not.toBe(out[1].main.tempId)
    expect(out[0].main.name).toBe('Daiquiri')
  })

  it('accepts a bare single recipe (has ingredients, no recipes array)', () => {
    const out = finishParse(RECIPE, '')
    expect(out).toHaveLength(1)
    expect(out[0].main.ingredients).toHaveLength(2)
  })

  it('drops recipes with no usable ingredients and returns [] for junk', () => {
    expect(finishParse({ recipes: [{ name: 'Empty', ingredients: [] }] }, '')).toEqual([])
    expect(finishParse({ nonsense: true }, '')).toEqual([])
    expect(finishParse(null, '')).toEqual([])
  })

  it('records a YouTube source URL found in the text', () => {
    const out = finishParse({ recipes: [RECIPE] }, 'Recipe from https://youtu.be/abcdefghijk enjoy')
    expect(out[0].main.source?.type).toBe('youtube')
    expect(out[0].main.source?.videoId).toBe('abcdefghijk')
  })
})
