import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import {
  bottleCovers,
  bottleFor,
  canMake,
  categorySubstitutions,
  isStaple,
  makeableIds,
  missingBottles,
  normIngredient,
  shelfKeys,
} from './availability'

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

const oldFashioned = recipe({
  id: 'oldf',
  name: 'Old Fashioned',
  spirit: 'whiskey',
  ingredients: [
    { id: 'o1', name: 'Bourbon', amount: 2, unit: 'oz' },
    { id: 'o2', name: 'Sugar', amount: 1, unit: 'tsp' },
  ],
})

const byId = new Map<string, Recipe>(
  [daiquiri, negroni, syrup, oldFashioned].map((r) => [r.id, r]),
)

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

describe('category substitution', () => {
  it('a generic rum satisfies a "White rum" call', () => {
    const genericRum = new Set([normIngredient('rum')])
    expect(canMake(daiquiri, genericRum, byId, true)).toBe(true)
  })

  it('a whiskey brand satisfies a "bourbon" call', () => {
    const woodford = new Set([normIngredient('Woodford Reserve')])
    expect(canMake(oldFashioned, woodford, byId, true)).toBe(true)
  })

  it('does not substitute non-base-spirit categories (Campari ≠ Chartreuse)', () => {
    // stocking Campari (liqueur) must not make a Negroni that also needs gin/vermouth
    const campariOnly = new Set([normIngredient('Campari')])
    expect(canMake(negroni, campariOnly, byId, true)).toBe(false)
  })

  it('reports what is covered only by substitution, not exact stock', () => {
    expect(categorySubstitutions(daiquiri, new Set([normIngredient('rum')]), true)).toEqual([
      { required: 'White rum', usingCategory: 'rum' },
    ])
    // exact bottle stocked → no substitution reported
    expect(
      categorySubstitutions(daiquiri, new Set([normIngredient('White rum')]), true),
    ).toEqual([])
  })
})

describe('bottleCovers / bottleFor', () => {
  it('answers the same question canMake does, one pair at a time', () => {
    // Whatever canMake accepts from a one-bottle bar, bottleCovers must too —
    // that agreement is the whole reason it exists.
    expect(bottleCovers('rum', 'White rum')).toBe('category')
    expect(canMake(daiquiri, new Set([normIngredient('rum')]), byId, true)).toBe(true)

    expect(bottleCovers('Woodford Reserve', 'Bourbon')).toBe('category')
    expect(bottleCovers('Campari', 'Green Chartreuse')).toBe(null)
  })

  it('reports an exact bottle as exact, whatever the spelling', () => {
    expect(bottleCovers('White Rum', 'white rum')).toBe('exact')
    expect(bottleCovers('Lime juice', 'Fresh lime juice')).toBe('exact')
  })

  it('does not match unrelated names', () => {
    expect(bottleCovers('Gin', 'Lime juice')).toBe(null)
    expect(bottleCovers('', 'Gin')).toBe(null)
  })

  it('prefers the exact bottle over a same-family stand-in', () => {
    const shelf = [{ label: 'Rittenhouse Rye' }, { label: 'Bourbon' }]
    expect(bottleFor('Bourbon', shelf)).toEqual({ bottle: { label: 'Bourbon' }, via: 'exact' })
  })

  it('falls back to a stand-in from the same family', () => {
    const shelf = [{ label: 'Campari' }, { label: 'Rittenhouse Rye' }]
    expect(bottleFor('Bourbon', shelf)).toEqual({
      bottle: { label: 'Rittenhouse Rye' },
      via: 'category',
    })
  })

  it('finds nothing on a shelf that cannot cover the call', () => {
    expect(bottleFor('Green Chartreuse', [{ label: 'Campari' }])).toBe(null)
  })
})

describe('shelfKeys', () => {
  const shelf = (...bottles: { name: string; label: string; category?: string }[]) =>
    new Set(bottles.flatMap(shelfKeys))

  it('carries a family the bottle name alone would lose', () => {
    // "Smith & Cross" normalizes to "smith cross"; guessing a family from that
    // key is how a stocked rum used to make the Daiquiri unmakeable.
    const rum = { name: normIngredient('Smith & Cross'), label: 'Smith & Cross', category: 'rum' }
    expect(canMake(daiquiri, shelf(rum), byId, true)).toBe(true)
  })

  it('lets a corrected category decide what the bottle substitutes for', () => {
    const mystery = { name: 'grandpa s bottle', label: "Grandpa's bottle" }
    expect(canMake(oldFashioned, shelf(mystery), byId, true)).toBe(false)
    expect(canMake(oldFashioned, shelf({ ...mystery, category: 'whiskey' }), byId, true)).toBe(true)
  })

  it('still refuses a stand-in from a family that does not substitute', () => {
    const amaro = { name: 'campari', label: 'Campari', category: 'liqueur' }
    expect(canMake(negroni, shelf(amaro), byId, true)).toBe(false)
  })

  it('gives a bottle with no family a single key', () => {
    expect(shelfKeys({ name: 'lime juice', label: 'Lime juice' })).toEqual(['lime juice'])
  })
})
