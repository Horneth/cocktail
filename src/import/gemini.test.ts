import { describe, expect, it } from 'vitest'
import { mapGeminiRecipe, type GeminiRecipe } from './gemini'

const SAMPLE: GeminiRecipe = {
  name: 'Whiskey Sour',
  kind: 'cocktail',
  spirit: 'bourbon', // synonym -> whiskey
  method: 'Shake',
  glassware: 'Rocks',
  garnish: 'Orange peel',
  tags: ['Sour', '#classic', 'sour'], // mixed case, hash, duplicate
  ingredients: [
    { amount: 2, unit: 'oz', name: 'Bourbon' },
    { amount: 0.75, unit: 'oz', name: 'Lemon Juice' },
    { amount: 0.75, unit: 'oz', name: 'Rich Simple Syrup' },
    { amount: 1, unit: 'each', name: 'Egg White', optional: true },
    { amount: null, unit: 'each', name: 'Orange peel' },
  ],
  subRecipes: [
    {
      name: 'Rich Simple Syrup',
      ingredients: [
        { amount: 2, unit: 'parts', name: 'sugar' },
        { amount: 1, unit: 'part', name: 'water' },
      ],
    },
  ],
}

describe('mapGeminiRecipe', () => {
  const r = mapGeminiRecipe(SAMPLE, 'https://youtu.be/abcdefghijk')

  it('maps the main recipe fields', () => {
    expect(r.main.name).toBe('Whiskey Sour')
    expect(r.main.kind).toBe('cocktail')
    expect(r.main.method).toBe('Shake')
    expect(r.main.garnish).toBe('Orange peel')
  })

  it('infers the base spirit, mapping synonyms to our enum', () => {
    expect(r.main.spirit).toBe('whiskey')
  })

  it('normalizes tags (lowercase, strip #, dedupe)', () => {
    expect(r.main.tags).toEqual(['sour', 'classic'])
  })

  it('coerces free-text units to our Unit set', () => {
    const syrup = r.components[0]
    expect(syrup.ingredients.map((i) => i.unit)).toEqual(['part', 'part'])
    expect(syrup.measureBasis).toBe('parts')
  })

  it('carries optional and null (to-taste) amounts', () => {
    const egg = r.main.ingredients.find((i) => i.name === 'Egg White')
    const peel = r.main.ingredients.find((i) => i.name === 'Orange peel')
    expect(egg?.optional).toBe(true)
    expect(peel?.amount).toBeNull()
  })

  it('cross-links the syrup ingredient to the component', () => {
    const syrupIng = r.main.ingredients.find((i) => i.name === 'Rich Simple Syrup')
    expect(syrupIng?.subRecipeRef).toBe(r.components[0].tempId)
  })

  it('records provenance from the source URL', () => {
    expect(r.main.source?.type).toBe('youtube')
    expect(r.main.source?.videoId).toBe('abcdefghijk')
  })

  it('falls back to a default name and tolerates missing sub-recipes', () => {
    const bare = mapGeminiRecipe({ ingredients: [{ name: 'Gin', unit: 'oz', amount: 2 }] })
    expect(bare.main.name).toBe('Imported cocktail')
    expect(bare.components).toEqual([])
  })
})

describe('mapGeminiRecipe — standalone syrup', () => {
  const syrup: GeminiRecipe = {
    name: 'Orgeat',
    kind: 'component',
    ingredients: [
      { amount: 2, unit: 'parts', name: 'almond milk' },
      { amount: 1, unit: 'part', name: 'sugar' },
    ],
  }
  const r = mapGeminiRecipe(syrup)

  it('imports a syrup-only description as a parts component, not a cocktail', () => {
    expect(r.main.kind).toBe('component')
    expect(r.main.measureBasis).toBe('parts')
    expect(r.main.spirit).toBeUndefined()
  })
})
