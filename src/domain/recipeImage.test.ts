import { describe, expect, it } from 'vitest'
import { IMAGE_CATALOG, glassKind } from './recipeImages'
import { suggestImages } from './recipeImage'
import type { Recipe } from '../db/schema'

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    kind: 'cocktail',
    name: 'Test',
    ingredients: [],
    measureBasis: 'absolute',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('glassKind', () => {
  it.each([
    ['Coupe', 'coupe'],
    ['Nick & Nora', 'coupe'],
    ['Martini', 'martini'],
    ['Rocks', 'rocks'],
    ['Old Fashioned', 'rocks'],
    ['Highball', 'highball'],
    ['Collins', 'collins'],
    ['Tiki mug', 'tiki'],
    ['Copper mug', 'tiki'],
    ['Flute', 'flute'],
    ['Shot', 'shot'],
    ['undefined', null],
  ])('maps "%s" to "%s"', (glass, kind) => {
    expect(glassKind(glass === 'undefined' ? undefined : glass)).toBe(kind)
  })
})

describe('suggestImages', () => {
  it('suggests the sour coupe for a Daiquiri', () => {
    const out = suggestImages(
      recipe({
        name: 'Daiquiri',
        spirit: 'rum',
        glassware: 'Coupe',
        garnish: 'Lime wheel',
        tags: ['sour', 'citrusy'],
        ingredients: [{ id: 'i1', name: 'White rum', amount: 2, unit: 'oz' }],
      }),
      3,
    )
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].slot.slug).toBe('sour-straw')
  })

  it('prefers the tiki shot for a Mai Tai', () => {
    const out = suggestImages(
      recipe({
        name: 'Mai Tai',
        spirit: 'rum',
        glassware: 'Rocks',
        garnish: 'Mint sprig',
        tags: ['tropical', 'tiki'],
        ingredients: [{ id: 'i1', name: 'Rum', amount: 2, unit: 'oz' }],
      }),
      3,
    )
    expect(out[0].slot.slug).toBe('mai-tai')
  })

  it('returns nothing when nothing matches', () => {
    const out = suggestImages(
      recipe({ name: 'Something', spirit: 'none', glassware: 'Fancy', tags: [] }),
      3,
    )
    expect(out).toEqual([])
  })

  it('catalog is non-empty and every slug is unique + file-safe', () => {
    expect(IMAGE_CATALOG.length).toBeGreaterThan(30)
    const slugs = IMAGE_CATALOG.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })
})