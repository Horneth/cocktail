import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { normIngredient } from './availability'
import { oneAwaySuggestions, unlocksFor } from './barInsights'

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
  ingredients: [
    { id: 'd1', name: 'White rum', amount: 2, unit: 'oz' },
    { id: 'd2', name: 'Lime juice', amount: 0.75, unit: 'oz' },
    { id: 'd3', name: 'Simple Syrup', amount: 0.75, unit: 'oz', subRecipeId: 'syrup' },
  ],
})

const negroni = recipe({
  id: 'negroni',
  name: 'Negroni',
  ingredients: [
    { id: 'n1', name: 'Gin', amount: 1, unit: 'oz' },
    { id: 'n2', name: 'Campari', amount: 1, unit: 'oz' },
    { id: 'n3', name: 'Sweet vermouth', amount: 1, unit: 'oz' },
  ],
})

const martini = recipe({
  id: 'martini',
  name: 'Martini',
  ingredients: [
    { id: 'm1', name: 'Gin', amount: 2.5, unit: 'oz' },
    { id: 'm2', name: 'Dry vermouth', amount: 0.5, unit: 'oz' },
  ],
})

const cocktails = [daiquiri, negroni, martini]
const byId = new Map<string, Recipe>([...cocktails, syrup].map((r) => [r.id, r]))
const bar = (...labels: string[]) => new Set(labels.map(normIngredient))

describe('unlocksFor', () => {
  it('counts only the recipes that were not already makeable', () => {
    // Gin + dry vermouth already covers the Martini; adding rum only adds the Daiquiri.
    const have = bar('Gin', 'Dry vermouth')
    const result = unlocksFor(['White rum'], cocktails, byId, have, true)
    expect(result.unlocks).toBe(1)
    expect(result.recipeIds).toEqual(['daiquiri'])
  })

  it('credits a combination that only pays off together', () => {
    const have = bar('Gin')
    expect(unlocksFor(['Campari'], cocktails, byId, have, true).unlocks).toBe(0)
    expect(unlocksFor(['Sweet vermouth'], cocktails, byId, have, true).unlocks).toBe(0)
    expect(unlocksFor(['Campari', 'Sweet vermouth'], cocktails, byId, have, true).unlocks).toBe(1)
  })

  it('counts a drink whose sub-recipe becomes makeable', () => {
    // With staples off, the Daiquiri needs rum, lime AND a makeable simple syrup.
    const have = bar('White rum', 'Lime juice', 'Water')
    expect(unlocksFor(['White sugar'], cocktails, byId, have, false).recipeIds).toEqual(['daiquiri'])
  })

  it('respects assumeStaples', () => {
    const have = bar('Gin', 'Campari')
    // With staples assumed the Negroni still needs vermouth either way, but the
    // Daiquiri's lime is only free when staples are assumed.
    expect(unlocksFor(['White rum'], cocktails, byId, have, true).unlocks).toBe(1)
    expect(unlocksFor(['White rum'], cocktails, byId, have, false).unlocks).toBe(0)
  })

  it('is a no-op for a bottle already on the shelf', () => {
    const have = bar('Gin')
    expect(unlocksFor(['gin'], cocktails, byId, have, true)).toEqual({ unlocks: 0, recipeIds: [] })
  })

  it('reuses a supplied baseline', () => {
    const have = bar('Gin', 'Dry vermouth')
    const baseline = new Set(['martini'])
    expect(unlocksFor(['White rum'], cocktails, byId, have, true, baseline).unlocks).toBe(1)
  })
})

describe('oneAwaySuggestions', () => {
  it('ranks the bottles that unlock the most drinks', () => {
    // Gin is the only thing missing from both the Negroni and the Martini.
    const have = bar('Campari', 'Sweet vermouth', 'Dry vermouth')
    const [top] = oneAwaySuggestions(cocktails, byId, have, true)
    expect(top.name).toBe('gin')
    expect(top.unlocks).toBe(2)
    expect(top.recipeIds.sort()).toEqual(['martini', 'negroni'])
  })

  it('ignores recipes that are already makeable', () => {
    const have = bar('Gin', 'Dry vermouth')
    const names = oneAwaySuggestions(cocktails, byId, have, true).map((s) => s.name)
    expect(names).not.toContain('dry vermouth')
  })

  it('ignores recipes that are more than one bottle away', () => {
    // An empty bar leaves the Negroni three bottles short — nothing is one away.
    expect(oneAwaySuggestions([negroni], byId, new Set(), true)).toEqual([])
  })

  it('respects the limit', () => {
    const suggestions = oneAwaySuggestions(cocktails, byId, bar('Gin', 'Campari'), true, 1)
    expect(suggestions).toHaveLength(1)
  })

  it('returns nothing for an empty library', () => {
    expect(oneAwaySuggestions([], byId, new Set(), true)).toEqual([])
  })
})
