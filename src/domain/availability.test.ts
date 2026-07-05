import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { canMake, isStaple, makeableIds, missingBottles, normIngredient } from './availability'

let n = 0
function recipe(partial: Partial<Recipe> & { name: string; ingredients: Recipe['ingredients'] }): Recipe {
  return {
    id: partial.id ?? `r${(n += 1)}`,
    kind: 'cocktail',
    measureBasis: 'absolute',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const syrup = recipe({
  id: 'syrup',
  name: 'Simple Syrup',
  kind: 'component',
  measureBasis: 'parts',
  ingredients: [
    { id: 's1', name: 'White sugar', amount: 1, unit: 'part' },
    { id: 's2', name: 'Water', amount: 1, unit: 'part' },
  ],
})

const daiquiri = recipe({
  id: 'daiquiri',
  name: 'Daiquiri',
  spirit: 'rum',
  ingredients: [
    { id: 'd1', name: 'White rum', amount: 2, unit: 'oz' },
    { id: 'd2', name: 'Lime juice', amount: 0.75, unit: 'oz' },
    { id: 'd3', name: 'Simple Syrup', amount: 0.75, unit: 'oz', subRecipeId: 'syrup' },
  ],
})

const negroni = recipe({
  id: 'negroni',
  name: 'Negroni',
  spirit: 'gin',
  ingredients: [
    { id: 'n1', name: 'Gin', amount: 1, unit: 'oz' },
    { id: 'n2', name: 'Campari', amount: 1, unit: 'oz' },
    { id: 'n3', name: 'Sweet Vermouth', amount: 1, unit: 'oz' },
  ],
})

const byId = new Map<string, Recipe>([daiquiri, negroni, syrup].map((r) => [r.id, r]))

describe('normIngredient', () => {
  it('collapses casing, qualifiers and parentheticals', () => {
    expect(normIngredient('Freshly Squeezed Lime Juice')).toBe('lime juice')
    expect(normIngredient('Rich Simple Syrup (2:1)')).toBe('rich simple syrup')
  })
})

describe('isStaple', () => {
  it('treats basics and garnishes as staples but not bottles', () => {
    expect(isStaple(normIngredient('Lime juice'))).toBe(true)
    expect(isStaple(normIngredient('Club soda'))).toBe(true)
    expect(isStaple(normIngredient('Orange peel'))).toBe(true)
    expect(isStaple(normIngredient('Campari'))).toBe(false)
    expect(isStaple(normIngredient('Orange liqueur'))).toBe(false)
  })
})

describe('canMake with assumeStaples on', () => {
  it('empty bar cannot make a Daiquiri (needs rum)', () => {
    expect(canMake(daiquiri, new Set(), byId, true)).toBe(false)
  })

  it('one bottle (white rum) makes a Daiquiri — lime/sugar/water assumed, syrup auto-made', () => {
    expect(canMake(daiquiri, new Set([normIngredient('White rum')]), byId, true)).toBe(true)
  })

  it('needs all three bottles for a Negroni', () => {
    const two = new Set([normIngredient('Gin'), normIngredient('Campari')])
    expect(canMake(negroni, two, byId, true)).toBe(false)
    two.add(normIngredient('Sweet Vermouth'))
    expect(canMake(negroni, two, byId, true)).toBe(true)
  })

  it('a standalone syrup is makeable from assumed staples', () => {
    expect(canMake(syrup, new Set(), byId, true)).toBe(true)
  })
})

describe('canMake with assumeStaples off', () => {
  it('now the fresh + syrup ingredients must be stocked too', () => {
    const rumOnly = new Set([normIngredient('White rum')])
    expect(canMake(daiquiri, rumOnly, byId, false)).toBe(false)
    // stock lime juice + the syrup itself
    rumOnly.add(normIngredient('Lime juice'))
    rumOnly.add(normIngredient('Simple Syrup'))
    expect(canMake(daiquiri, rumOnly, byId, false)).toBe(true)
  })
})

describe('makeableIds + missingBottles', () => {
  it('filters a list to what is makeable', () => {
    const have = new Set([normIngredient('White rum')])
    const ids = makeableIds([daiquiri, negroni], byId, have, true)
    expect(ids.has('daiquiri')).toBe(true)
    expect(ids.has('negroni')).toBe(false)
  })

  it('reports the missing bottles for a not-yet-makeable drink', () => {
    expect(missingBottles(negroni, new Set([normIngredient('Gin')]), byId, true)).toEqual([
      'Campari',
      'Sweet Vermouth',
    ])
    expect(missingBottles(daiquiri, new Set([normIngredient('White rum')]), byId, true)).toEqual([])
  })
})
