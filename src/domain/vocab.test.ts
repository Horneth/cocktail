import { describe, expect, it } from 'vitest'
import { GLASSES, METHODS, TAGS, TAG_KEYS, canonical, libraryTags, matchesTags, tagEmoji } from './vocab'

describe('vocab', () => {
  it('gives every listed tag a glyph and falls back for the rest', () => {
    for (const key of TAG_KEYS) expect(TAGS[key]).toBeTruthy()
    expect(tagEmoji('sour')).toBe('🍋')
    expect(tagEmoji('invented-by-the-model')).toBe('🏷️')
  })

  it('lists a library’s tags in vocabulary order, extras after', () => {
    expect(libraryTags([{ tags: ['tropical', 'sour'] }, { tags: ['Classic', ' sour '] }, { tags: ['smoky-peat'] }])).toEqual([
      'classic', 'sour', 'tropical', 'smoky-peat',
    ])
    expect(libraryTags([{ tags: [] }])).toEqual([])
  })

  it('filters recipes that carry every selected tag, case-insensitively', () => {
    const recipe = { tags: ['Sour', 'classic'] }
    expect(matchesTags(recipe, ['sour'])).toBe(true)
    expect(matchesTags(recipe, ['sour', 'classic'])).toBe(true)
    expect(matchesTags(recipe, ['sour', 'citrusy'])).toBe(false)
    expect(matchesTags(recipe, [])).toBe(true)
  })

})

describe('canonical', () => {
  it('snaps casing onto a vocabulary entry', () => {
    expect(canonical('shake', METHODS)).toBe('Shake')
    expect(canonical('  ROCKS ', GLASSES)).toBe('Rocks')
  })

  it('passes an unlisted value through rather than dropping it', () => {
    expect(canonical('Copper mug', GLASSES)).toBe('Copper mug')
  })

  it('treats blank as absent', () => {
    expect(canonical('   ', GLASSES)).toBeUndefined()
    expect(canonical(undefined, GLASSES)).toBeUndefined()
  })
})
