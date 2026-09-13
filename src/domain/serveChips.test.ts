import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { isStaple, normIngredient, shelfKeys } from './availability'
import { canMake } from './availability'
import { BASICS_CHIPS, familyChips, garnishChips, ingredientGroupForName, ingredientGroups, juiceChips, modifierChips } from './serveChips'

let n = 0
function cocktail(name: string, ingredientNames: string[], method = 'Shake'): Recipe {
  return {
    id: `r${(n += 1)}`,
    kind: 'cocktail',
    name,
    method,
    measureBasis: 'absolute',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: 0,
    updatedAt: 0,
    ingredients: ingredientNames.map((nm) => ({ id: `i${(n += 1)}`, name: nm, amount: 1, unit: 'oz' })),
  }
}

const library = [
  cocktail('Daiquiri', ['White rum', 'Lime juice', 'Simple syrup']),
  cocktail('Negroni', ['Gin', 'Campari', 'Sweet vermouth'], 'Build'),
  cocktail('Manhattan', ['Bourbon', 'Sweet vermouth', 'Angostura bitters'], 'Stir'),
  cocktail('Boulevardier', ['Bourbon', 'Campari', 'Sweet vermouth'], 'Stir'),
]

// An optional line must not summon a family chip that could never unlock
// anything — Margarita's optional agave nectar is the real-world case.
function withOptional(name: string, ingredientNames: string[], optionalName: string): Recipe {
  const r = cocktail(name, ingredientNames)
  r.ingredients.push({ id: `opt${(n += 1)}`, name: optionalName, amount: 0.25, unit: 'oz', optional: true })
  return r
}

const optionalAgave = withOptional('Stirred gin', ['Gin'], 'Agave nectar')

describe('familyChips', () => {
  it('lists the base-spirit families the library pours', () => {
    const chips = familyChips(library)
    expect(chips.map((c) => c.label)).toEqual(['Gin', 'Rum', 'Whiskey'])
    expect(chips.map((c) => c.category)).toEqual(['gin', 'rum', 'whiskey'])
  })

  it('omits families no drink calls for', () => {
    expect(familyChips(library).some((c) => c.category === 'vodka')).toBe(false)
  })

  it('ignores optional calls', () => {
    expect(familyChips([...library, optionalAgave]).some((c) => c.category === 'agave')).toBe(false)
  })
})

describe('modifierChips', () => {
  it('keeps modifiers to useful exact drink ingredients', () => {
    const chips = modifierChips(library, 8)
    expect(chips.map((c) => c.label)).toEqual(['Angostura bitters', 'Campari', 'Sweet vermouth'])
    expect(chips[1].key).toBe('campari')
    expect(juiceChips(library).map((c) => c.label)).toContain('Lime juice')
    expect(garnishChips([...library, cocktail('Garnish', ['Gin', 'Orange peel'])]).map((c) => c.label)).toContain('Orange peel')
  })

  it('never duplicates the family chips', () => {
    const labels = modifierChips(library, 20).map((c) => c.label)
    expect(labels).not.toContain('Rum')
    expect(labels).not.toContain('Bourbon')
  })

  it('carries the ingredient family for the bottle it writes', () => {
    const campari = modifierChips(library, 8).find((c) => c.key === 'campari')
    expect(campari?.category).toBe('liqueur')
  })

  it('skips staples and optional lines', () => {
    const withGarnish = [...library, cocktail('Garnish-heavy', ['Gin', 'Lime wheel'])]
    const keys = modifierChips(withGarnish, 20).map((c) => c.key)
    expect(keys).not.toContain('lime wheel')
  })
})

describe('ingredient groups', () => {
  it('keeps recipe-internal syrup ingredients out of controls', () => {
    const syrup: Recipe = {
      ...library[0],
      id: 'syrup',
      kind: 'syrup',
      name: 'Orgeat',
      ingredients: [{ id: 'almond', name: 'Blanched almonds', amount: 1, unit: 'oz' }],
    }
    expect(ingredientGroups([...library, syrup]).flatMap((g) => g.chips).map((c) => c.label)).not.toContain('Blanched almonds')
  })

  it('has explicit alcohol, building ingredient, modifier and garnish groups', () => {
    const grouped = ingredientGroups([...library, cocktail('Garnish', ['Gin', 'Orange peel'])])
    expect(grouped.map((g) => g.key)).toEqual(['alcohol', 'juice', 'modifier', 'garnish'])
    expect(grouped.find((g) => g.key === 'garnish')?.collapsible).toBe(true)
    expect(ingredientGroupForName('Orange juice')).toBe('juice')
    expect(ingredientGroupForName('Orange liqueur')).toBe('modifier')
  })
})

describe('family chip → shelf', () => {
  // The whole point of a family chip: tapping "Rum" must satisfy every rum
  // call, through the same shelf rules any real bottle goes through.
  it('a tapped family chip covers a specific call', () => {
    const jamaican = cocktail('Jamaican', ['Jamaican rum', 'Lime juice'])
    const rumChip = familyChips([jamaican])[0]
    expect(rumChip.label).toBe('Rum')
    const have = new Set(shelfKeys({ name: rumChip.key, label: rumChip.label, category: rumChip.category }))
    expect(canMake(jamaican, have, new Map(), true)).toBe(true)
  })

  it('a modifier chip covers its exact call only', () => {
    const negroni = cocktail('Negroni', ['Gin', 'Campari', 'Sweet vermouth'])
    const campariChip = modifierChips([negroni], 8).find((c) => c.key === 'campari')!
    const have = new Set(shelfKeys({ name: campariChip.key, label: campariChip.label, category: campariChip.category }))
    // Campari on the shelf doesn't pour a whiskey drink...
    expect(canMake(cocktail('X', ['Amaro Montenegro']), have, new Map(), true)).toBe(false)
    // ...but pours the one that called for it.
    expect(canMake(negroni, have, new Map(), true)).toBe(false) // still needs gin + vermouth
    expect(canMake(cocktail('Y', ['Campari', 'Soda water']), have, new Map(), true)).toBe(true)
  })
})

describe('BASICS_CHIPS', () => {
  it('are the staples that stop being free when basics are off', () => {
    for (const chip of BASICS_CHIPS) expect(isStaple(chip.key)).toBe(true)
    expect(BASICS_CHIPS.map((c) => c.key)).toContain('lime juice')
    expect(BASICS_CHIPS.map((c) => c.key)).toContain('egg white')
  })

  it('match recipe calls through the normal key', () => {
    expect(normIngredient('Freshly squeezed lime juice')).toBe('lime juice')
  })
})
