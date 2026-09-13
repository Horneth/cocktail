import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { makeableIds, normIngredient } from './availability'
import { catalog, needsFor, pickLineup, styleLabel } from './lineup'

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

const ing = (name: string, amount = 1) => ({ id: `i-${name}-${(n += 1)}`, name, amount, unit: 'oz' as const })

const negroni = recipe({
  name: 'Negroni',
  spirit: 'gin',
  method: 'Build',
  ingredients: [ing('Gin'), ing('Campari'), ing('Sweet vermouth')],
})
const martini = recipe({
  name: 'Martini',
  spirit: 'gin',
  method: 'Stir',
  ingredients: [ing('Gin', 2), ing('Dry vermouth', 2)],
})
const manhattan = recipe({
  name: 'Manhattan',
  spirit: 'whiskey',
  method: 'Stir',
  ingredients: [ing('Bourbon', 2), ing('Sweet vermouth')],
})
const daiquiri = recipe({
  name: 'Daiquiri',
  spirit: 'rum',
  method: 'Shake',
  ingredients: [ing('White rum', 2), ing('Lime juice', 0.75), ing('Simple syrup', 0.75)],
})
const maiTai = recipe({
  name: 'Mai Tai',
  spirit: 'rum',
  method: 'Shake',
  ingredients: [
    ing('White rum'), ing('Jamaican rum'), ing('Orange curaçao'),
    ing('Orgeat'), ing('Lime juice'),
  ],
})
const ginTonic = recipe({
  name: 'Gin & Tonic',
  spirit: 'gin',
  method: 'Build',
  ingredients: [
    ing('Gin', 2),
    ing('Tonic water', 4),
    { id: 'gt-garnish', name: 'Lime wedge', amount: null, unit: 'wedge' },
  ],
})

// Gin + Campari + sweet vermouth on the shelf.
const have = new Set(['gin', 'campari', 'sweet vermouth'])
const byId = new Map([negroni, martini, manhattan, daiquiri, maiTai, ginTonic].map((r) => [r.id, r]))
const all = [...byId.values()]

describe('styleLabel', () => {
  it('reads method and spirit', () => {
    expect(styleLabel(negroni)).toBe('Built · Gin')
    expect(styleLabel(daiquiri)).toBe('Shaken · Rum')
  })

  it('falls back when method or spirit is missing', () => {
    expect(styleLabel(recipe({ name: 'X', spirit: 'gin', ingredients: [ing('Gin')] }))).toBe('Gin')
    expect(styleLabel(recipe({ name: 'X', spirit: 'other', ingredients: [ing('Gin')] }))).toBe('Cocktail')
    expect(styleLabel(recipe({ name: 'X', method: 'swizzle', spirit: 'gin', ingredients: [ing('Gin')] }))).toBe('Swizzled · Gin')
    expect(styleLabel(recipe({ name: 'X', method: 'Fat wash', spirit: 'other', ingredients: [ing('Gin')] }))).toBe('Fat wash')
  })
})

describe('pickLineup', () => {
  it('returns only makeable drinks', () => {
    const picked = pickLineup(all, byId, have, true, 6)
    expect(picked.map((e) => e.recipe.name).sort()).toEqual(['Gin & Tonic', 'Negroni'])
  })

  it('is easy-first within the ready set', () => {
    const picked = pickLineup(all, byId, have, true, 6)
    expect(picked[0].recipe.name).toBe('Gin & Tonic') // 2 non-optional ingredients
    expect(picked[1].recipe.name).toBe('Negroni')
  })

  it('spreads across methods before repeating one', () => {
    // Gin, campari, sweet vermouth, bourbon, rum: four ready drinks across
    // three methods. The first three must each be a different method, led by
    // the easiest — the two-ingredient Manhattan.
    const shelf = new Set([...have, 'bourbon', 'white rum', 'simple syrup'])
    const picked = pickLineup(all, byId, shelf, true, 4)
    const methods = picked.map((e) => e.recipe.method)
    expect(new Set(methods.slice(0, 3)).size).toBe(3)
    expect(picked[0].recipe.name).toBe('Manhattan')
  })

  it('prefers an unpoured spirit when methods repeat', () => {
    // Two stirred gin drinks and one stirred whiskey drink: the second stir
    // should be the Manhattan, not Martini+Negroni twice in a row... — with
    // method diversity exhausted, spirit variety breaks the tie.
    const shelf = new Set([...have, 'bourbon'])
    const picked = pickLineup([negroni, martini, manhattan], byId, shelf, true, 3)
    expect(picked.map((e) => e.recipe.name)).toContain('Manhattan')
  })

  it('is deterministic', () => {
    const shelf = new Set([...have, 'bourbon', 'white rum', 'simple syrup'])
    const a = pickLineup(all, byId, shelf, true, 6)
    const b = pickLineup(all, byId, shelf, true, 6)
    expect(a.map((e) => e.recipe.id)).toEqual(b.map((e) => e.recipe.id))
  })

  it('flags category substitutions on the entry', () => {
    // "Jamaican rum" (Mai Tai) satisfied by the rum family key — note the
    // shelf keys go through normIngredient, which strips non-ASCII.
    const shelf = new Set([
      'rum',
      normIngredient('Orange curaçao'),
      'orgeat',
      'lime juice',
    ])
    const picked = pickLineup([maiTai], byId, shelf, true, 6)
    expect(picked).toHaveLength(1)
    expect(picked[0].subs).toEqual([
      { required: 'White rum', usingCategory: 'rum' },
      { required: 'Jamaican rum', usingCategory: 'rum' },
    ])
  })
})

describe('catalog', () => {
  // Shelf: gin + campari + sweet vermouth → Negroni and Gin & Tonic ready,
  // Martini one bottle away (dry vermouth), everything else short.
  it('tiers ready → close → out, easy-first within a tier', () => {
    const entries = catalog(all, byId, have, true)
    const tiers = entries.map((e) => e.tier)
    expect(tiers).toContain('ready')
    expect(tiers).toContain('close')
    expect(tiers).toContain('out')
    // Within a tier: fewest ingredients first.
    const ready = entries.filter((e) => e.tier === 'ready')
    expect(ready[0].recipe.name).toBe('Gin & Tonic')
    // All ready entries precede every close entry, which precede the out ones.
    const ranks = entries.map((e) => ({ ready: 0, close: 1, out: 2 })[e.tier])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('names the single missing bottle', () => {
    const entries = catalog(all, byId, have, true)
    const martini = entries.find((e) => e.recipe.name === 'Martini')!
    expect(martini.tier).toBe('close')
    expect(martini.missing).toEqual(['Dry vermouth'])
    const maiTai = entries.find((e) => e.recipe.name === 'Mai Tai')
    expect(maiTai?.tier).toBe('out')
    expect(maiTai!.missing.length).toBeGreaterThan(1)
  })

  it('carries the style label and effort', () => {
    const entries = catalog([daiquiri], byId, new Set(['rum', 'simple syrup']), true)
    expect(entries[0]).toMatchObject({ style: 'Shaken · Rum', tier: 'ready', missing: [] })
    expect(entries[0].effort).toBe(3)
  })
})

describe('needsFor', () => {
  // The shelf is gin + campari + sweet vermouth: Negroni and Gin & Tonic are
  // ready. The manifest is everything they call for that the shelf doesn't
  // already answer, with what the shelf DOES answer flagged.
  it('lists the unstocked needs first, stocked after', () => {
    const ready = all.filter((r) => makeableIds([r], byId, have, true).has(r.id))
    const needs = needsFor(ready, have)
    // The shopping list leads: tonic water is the one thing the shelf and the
    // staples assumption don't put in the host's hand. The rest is stocked,
    // leaning-drinks-first (gin counts twice: Negroni and the G&T).
    expect(needs.map((n) => n.key)).toEqual(['tonic water', 'gin', 'campari', 'sweet vermouth'])
    expect(needs[0].stocked).toBe(false)
    expect(needs[0].count).toBe(1)
    expect(needs.slice(1).every((n) => n.stocked)).toBe(true)
  })

  it('alcohols appear too — flagged when the shelf answers by family', () => {
    const needs = needsFor([daiquiri], new Set(['rum']))
    const rum = needs.find((n) => n.key === 'white rum')!
    expect(rum).toMatchObject({ label: 'White rum', stocked: true, count: 1 })
    expect(needs.map((n) => n.key)).toEqual(['lime juice', 'simple syrup', 'white rum'])
    expect(needs.filter((n) => !n.stocked).map((n) => n.key)).toEqual(['lime juice', 'simple syrup'])
  })

  it('dedupes by match key across drinks, keeping the recipe spelling', () => {
    const negroni2 = recipe({
      name: 'Boulevardier',
      spirit: 'whiskey',
      method: 'Stir',
      ingredients: [ing('Bourbon'), ing('Campari'), ing('Sweet vermouth')],
    })
    const needs = needsFor([negroni, negroni2], new Set(['gin', 'bourbon']))
    expect(needs.find((n) => n.key === 'campari')).toMatchObject({ label: 'Campari', count: 2 })
  })

  it('never lists garnish lines — with or without amounts', () => {
    expect(needsFor([ginTonic], new Set(['gin'])).some((n) => n.key === 'lime wedge')).toBe(false)
  })

  it('lists a "to top" soda even though the engine assumes it', () => {
    const needs = needsFor([ginTonic], new Set(['gin']))
    expect(needs.map((n) => n.key)).toEqual(['tonic water', 'gin'])
    expect(needs[0].stocked).toBe(false)
    expect(needs[1].stocked).toBe(true)
  })
})
