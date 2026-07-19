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
    expect(categoryForName('Simple Syrup')).toBeUndefined()
  })

  it('excludes liqueur/wine/mocktail from matchable categories', () => {
    expect(MATCHABLE_CATEGORIES.has('rum')).toBe(true)
    expect(MATCHABLE_CATEGORIES.has('whiskey')).toBe(true)
    expect(MATCHABLE_CATEGORIES.has('liqueur')).toBe(false)
    expect(MATCHABLE_CATEGORIES.has('wine')).toBe(false)
    expect(MATCHABLE_CATEGORIES.has('mocktail')).toBe(false)
  })
})
