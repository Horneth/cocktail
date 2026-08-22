import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { duplicateMixerGroups, normalizeMixerName } from './textNormalize'

function mixer(id: string, name: string): Recipe {
  return {
    id,
    name,
    kind: 'syrup',
    ingredients: [],
    measureBasis: 'parts',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('normalizeMixerName', () => {
  it('collapses richness adjectives and ratio parentheticals', () => {
    expect(normalizeMixerName('Simple Syrup')).toBe('simple syrup')
    expect(normalizeMixerName('Rich Simple Syrup')).toBe('simple syrup')
    expect(normalizeMixerName('Semi-Rich Simple Syrup (1.5:1)')).toBe('simple syrup')
  })

  it('keeps genuinely different names distinct', () => {
    expect(normalizeMixerName('Orgeat')).not.toBe(normalizeMixerName('Simple Syrup'))
  })
})

describe('duplicateMixerGroups', () => {
  it('groups mixers whose normalized names collide', () => {
    const groups = duplicateMixerGroups([
      mixer('a', 'Simple Syrup'),
      mixer('b', 'Semi Rich Simple Syrup'),
      mixer('c', 'Orgeat'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('returns nothing when all names are distinct', () => {
    expect(
      duplicateMixerGroups([mixer('a', 'Simple Syrup'), mixer('b', 'Orgeat')]),
    ).toHaveLength(0)
  })
})
