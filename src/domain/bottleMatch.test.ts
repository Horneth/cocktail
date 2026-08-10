import { describe, expect, it } from 'vitest'
import type { PantryItem } from '../db/schema'
import { normIngredient } from './availability'
import { closeCandidates, exactMatch, localMatch, resolveDetections, similarity } from './bottleMatch'

const bottle = (label: string, category?: string): PantryItem => ({
  barId: 'bar',
  name: normIngredient(label),
  label,
  addedAt: 0,
  ...(category ? { category } : {}),
})

describe('similarity', () => {
  it('folds spelled-out numbers into digits', () => {
    expect(similarity('Plantation 3 Stars', 'Plantation Three Stars White Rum')).toBeGreaterThan(0.7)
  })

  it('still matches when one name is much longer', () => {
    expect(similarity('Tanqueray', 'Tanqueray No. Ten')).toBeGreaterThan(0.6)
  })

  it('is zero for unrelated bottles', () => {
    expect(similarity('Campari', 'Green Chartreuse')).toBe(0)
  })

  it('is zero for an empty name', () => {
    expect(similarity('', 'Campari')).toBe(0)
  })
})

describe('exactMatch', () => {
  it('matches across spelling differences that normalize away', () => {
    const existing = [bottle('Fresh Lime Juice')]
    expect(exactMatch('lime juice', existing)?.label).toBe('Fresh Lime Juice')
  })

  it('returns undefined when nothing matches', () => {
    expect(exactMatch('Campari', [bottle('Aperol')])).toBeUndefined()
  })
})

describe('closeCandidates', () => {
  const shelf = [
    bottle('Plantation Three Stars White Rum', 'rum'),
    bottle('Plantation O.F.T.D.', 'rum'),
    bottle('Tanqueray', 'gin'),
    bottle('Green Chartreuse', 'liqueur'),
  ]

  it('surfaces the near-variant first', () => {
    const [top] = closeCandidates({ name: 'Plantation 3 Stars', category: 'rum' }, shelf)
    expect(top.label).toBe('Plantation Three Stars White Rum')
  })

  it('never surfaces a same-category bottle with no name overlap', () => {
    // A matching base spirit alone must not make two bottles candidates, or
    // every gin would be a candidate for every other gin.
    const labels = closeCandidates({ name: 'Beefeater', category: 'gin' }, shelf).map((c) => c.label)
    expect(labels).not.toContain('Tanqueray')
  })

  it('does not confuse one liqueur for another', () => {
    expect(closeCandidates({ name: 'Campari', category: 'liqueur' }, shelf)).toEqual([])
  })

  it('boosts a candidate whose category agrees', () => {
    const shared = [bottle('Plantation Three Stars White Rum', 'rum')]
    const withCategory = closeCandidates({ name: 'Plantation 3 Stars', category: 'rum' }, shared)[0]
    const withOther = closeCandidates({ name: 'Plantation 3 Stars', category: 'gin' }, shared)[0]
    expect(withCategory.score).toBeGreaterThan(withOther.score)
  })

  it('respects the limit', () => {
    const many = [
      bottle('Plantation Three Stars White Rum', 'rum'),
      bottle('Plantation O.F.T.D.', 'rum'),
      bottle('Plantation Xaymaca', 'rum'),
    ]
    expect(closeCandidates({ name: 'Plantation 3 Stars', category: 'rum' }, many, 2)).toHaveLength(2)
  })
})

describe('localMatch', () => {
  const shelf = [bottle('Plantation Three Stars White Rum', 'rum'), bottle('Tanqueray', 'gin')]

  it('calls an exact string match "same" and asks the model nothing', () => {
    const result = localMatch({ name: 'tanqueray', category: 'gin' }, shelf)
    expect(result).toEqual({ verdict: 'same', match: 'Tanqueray', candidates: [] })
  })

  it('falls back to "variant" for a strong lexical match', () => {
    const result = localMatch({ name: 'Plantation 3 Stars', category: 'rum' }, shelf)
    expect(result.verdict).toBe('variant')
    expect(result.match).toBe('Plantation Three Stars White Rum')
  })

  it('is "new" with no candidates when nothing is close', () => {
    expect(localMatch({ name: 'Campari', category: 'liqueur' }, shelf)).toEqual({
      verdict: 'new',
      candidates: [],
    })
  })

  it('is "new" against an empty bar', () => {
    expect(localMatch({ name: 'Tanqueray' }, [])).toEqual({ verdict: 'new', candidates: [] })
  })
})

describe('resolveDetections', () => {
  const shelf = [bottle('Tanqueray', 'gin'), bottle('Plantation Three Stars White Rum', 'rum')]

  it('falls back to the local verdict when the reconcile pass returned nothing', () => {
    const [out] = resolveDetections([{ name: 'Plantation 3 Stars', category: 'rum' }], shelf)
    expect(out.verdict).toBe('variant')
    expect(out.match).toBe('Plantation Three Stars White Rum')
    expect(out.canonicalName).toBe('Plantation 3 Stars')
  })

  it('lets the model overrule a merely lexical guess', () => {
    // Locally this looks like a variant; the model knows it is the same bottle.
    const [out] = resolveDetections([{ name: 'Plantation 3 Stars', category: 'rum' }], shelf, [
      {
        detected: 'Plantation 3 Stars',
        verdict: 'same',
        match: 'Plantation Three Stars White Rum',
        canonicalName: 'Plantation 3 Stars White Rum',
      },
    ])
    expect(out.verdict).toBe('same')
    expect(out.canonicalName).toBe('Plantation 3 Stars White Rum')
  })

  it('never lets the model overrule an exact string match', () => {
    const [out] = resolveDetections([{ name: 'tanqueray', category: 'gin' }], shelf, [
      { detected: 'tanqueray', verdict: 'new' },
    ])
    expect(out.verdict).toBe('same')
    expect(out.match).toBe('Tanqueray')
  })

  it('keeps a clean "new" for a bottle nothing resembles', () => {
    const [out] = resolveDetections([{ name: 'Campari', category: 'liqueur' }], shelf)
    expect(out).toEqual({
      detected: { name: 'Campari', category: 'liqueur' },
      verdict: 'new',
      canonicalName: 'Campari',
      candidates: [],
    })
  })
})
