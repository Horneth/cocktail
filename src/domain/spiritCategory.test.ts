import { describe, expect, it } from 'vitest'
import { MATCHABLE_CATEGORIES, categoryForName } from './spiritCategory'

describe('categoryForName', () => {
  it('maps specific spirits and origins to their base family', () => {
    expect(categoryForName('Jamaican rum')).toBe('rum')
    expect(categoryForName('White rum')).toBe('rum')
    expect(categoryForName('Bourbon')).toBe('whiskey')
    expect(categoryForName('Rye whiskey')).toBe('whiskey')
    expect(categoryForName('Cachaça')).toBe('cachaça')
    expect(categoryForName('Reposado tequila')).toBe('tequila')
  })

  it('recognizes brand names with no family word', () => {
    expect(categoryForName('Woodford Reserve')).toBe('whiskey')
    expect(categoryForName("Tito's")).toBe('vodka')
    expect(categoryForName('Hendricks')).toBe('gin')
    expect(categoryForName('Cointreau')).toBe('liqueur')
    expect(categoryForName('Campari')).toBe('liqueur')
  })

  it('checks zero-proof before the base family (ordering invariant)', () => {
    expect(categoryForName('Non-alcoholic gin')).toBe('mocktail')
    expect(categoryForName('Seedlip')).toBe('mocktail')
  })

  it('returns undefined for non-spirit ingredients', () => {
    expect(categoryForName('Lime juice')).toBeUndefined()
    expect(categoryForName('Egg white')).toBeUndefined()
  })

  it('resolves mixers to their own syrup category', () => {
    expect(categoryForName('Simple Syrup')).toBe('syrup')
    expect(categoryForName('Grenadine')).toBe('syrup')
    expect(categoryForName('Orgeat')).toBe('syrup')
    expect(categoryForName('Lime Cordial')).toBe('syrup')
    expect(categoryForName('Rich Simple Syrup (2:1)')).toBe('syrup')
  })

  it('excludes liqueur/wine/mocktail/syrup from matchable categories', () => {
    expect(MATCHABLE_CATEGORIES.has('rum')).toBe(true)
    expect(MATCHABLE_CATEGORIES.has('whiskey')).toBe(true)
    expect(MATCHABLE_CATEGORIES.has('liqueur')).toBe(false)
    expect(MATCHABLE_CATEGORIES.has('wine')).toBe(false)
    expect(MATCHABLE_CATEGORIES.has('mocktail')).toBe(false)
    expect(MATCHABLE_CATEGORIES.has('syrup')).toBe(false)
  })
})

describe('names that have been through normIngredient', () => {
  it('still recognises a brand whose punctuation was stripped', () => {
    // `normIngredient` drops the ampersand, and a shelf is built from those keys.
    expect(categoryForName('Smith & Cross')).toBe('rum')
    expect(categoryForName('smith cross')).toBe('rum')
    expect(categoryForName('wray nephew')).toBe('rum')
  })
})
