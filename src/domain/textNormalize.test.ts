import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { duplicateComponentGroups, normalizeComponentName } from './textNormalize'

function comp(id: string, name: string): Recipe {
  return {
    id,
    name,
    kind: 'component',
    ingredients: [],
    measureBasis: 'parts',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('normalizeComponentName', () => {
  it('collapses richness adjectives and ratio parentheticals', () => {
    expect(normalizeComponentName('Simple Syrup')).toBe('simple syrup')
    expect(normalizeComponentName('Rich Simple Syrup')).toBe('simple syrup')
    expect(normalizeComponentName('Semi-Rich Simple Syrup (1.5:1)')).toBe('simple syrup')
  })

  it('keeps genuinely different names distinct', () => {
    expect(normalizeComponentName('Orgeat')).not.toBe(normalizeComponentName('Simple Syrup'))
  })
})

describe('duplicateComponentGroups', () => {
  it('groups components whose normalized names collide', () => {
    const groups = duplicateComponentGroups([
      comp('a', 'Simple Syrup'),
      comp('b', 'Semi Rich Simple Syrup'),
      comp('c', 'Orgeat'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('returns nothing when all names are distinct', () => {
    expect(
      duplicateComponentGroups([comp('a', 'Simple Syrup'), comp('b', 'Orgeat')]),
    ).toHaveLength(0)
  })
})
