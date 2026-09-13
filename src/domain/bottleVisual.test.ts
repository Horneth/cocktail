import { describe, expect, it } from 'vitest'
import {
  BOTTLE_IMAGE_CATEGORIES,
  bottlePortraitFor,
  categoryPortraitFor,
} from './bottleVisual'
import { BOTTLE_TYPES } from './spirits'
import { slugifyPoolKey } from './poolKey.mjs'

describe('bottleVisual', () => {
  it('has a category portrait for every real bottle family in the type picker', () => {
    // Syrups stay drawn (their identity is the liquid colour) and 'mocktail'
    // is a zero-proof recipe tile, not a bottle — everything else ships one.
    // 'other' is beyond the picker: the neutral floor portrait that keeps
    // uncategorised bottles off a bare glyph.
    const expected = BOTTLE_TYPES.filter((k) => k !== 'syrup' && k !== 'mocktail').concat('other')
    expect([...BOTTLE_IMAGE_CATEGORIES].sort()).toEqual([...expected].sort())
  })

  it('keys a bottle portrait by its name, under the pool slug rules', () => {
    expect(bottlePortraitFor('Campari')).toBe('/bottles/b/campari.webp')
    // Diacritics are stripped, so the shelf spelling survives the key.
    expect(bottlePortraitFor('Kahlúa')).toBe('/bottles/b/kahlua.webp')
    expect(bottlePortraitFor('Aperol')).toBe('/bottles/b/aperol.webp')
  })

  it('resolves spelling variants to one canonical portrait', () => {
    expect(bottlePortraitFor('Chartreuse Verte')).toBe('/bottles/b/green-chartreuse.webp')
    expect(bottlePortraitFor('Green Chartreuse')).toBe('/bottles/b/green-chartreuse.webp')
  })

  it('answers undefined for unusable labels', () => {
    expect(bottlePortraitFor('')).toBeUndefined()
    expect(bottlePortraitFor('   ')).toBeUndefined()
  })

  it('maps a category to its generic fallback portrait', () => {
    expect(categoryPortraitFor('gin')).toBe('/bottles/gin.webp')
    expect(categoryPortraitFor('whiskey')).toBe('/bottles/whiskey.webp')
  })

  it('gives the non-ASCII key an ASCII filename', () => {
    expect(categoryPortraitFor('cachaça')).toBe('/bottles/cachaca.webp')
  })

  it('answers undefined for categories without a portrait', () => {
    expect(categoryPortraitFor('syrup')).toBeUndefined()
    expect(categoryPortraitFor('mocktail')).toBeUndefined()
    expect(categoryPortraitFor('fernet-anything')).toBeUndefined()
    expect(categoryPortraitFor(undefined)).toBeUndefined()
  })

  it('uses the same slug rules as the drink pool', () => {
    // The contract that keeps the script's files and the app's lookups in
    // step is literally slugifyPoolKey — pin it so it can't drift.
    expect(bottlePortraitFor('Smith & Cross')).toBe(
      `/bottles/b/${slugifyPoolKey('Smith & Cross')}.webp`,
    )
  })
})