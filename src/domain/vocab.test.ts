import { describe, expect, it } from 'vitest'
import { PROMPT } from '../import/aiShared'
import { GLASSES, METHODS, TAGS, TAG_KEYS, canonical, tagEmoji } from './vocab'

describe('vocab', () => {
  it('gives every listed tag a glyph and falls back for the rest', () => {
    for (const key of TAG_KEYS) expect(TAGS[key]).toBeTruthy()
    expect(tagEmoji('sour')).toBe('🍋')
    expect(tagEmoji('invented-by-the-model')).toBe('🏷️')
  })

  it('is the single source the prompt is built from', () => {
    // The whole point of this module: the model can't be told about a vocabulary
    // the pickers don't offer (that mismatch is what it was extracted to fix).
    for (const tag of TAG_KEYS) expect(PROMPT).toContain(tag)
    for (const method of METHODS) expect(PROMPT).toContain(method)
    for (const glass of GLASSES) expect(PROMPT).toContain(glass)
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
