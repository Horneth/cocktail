import { describe, expect, it } from 'vitest'
import { normalizeRecipeName, shortlistCandidates } from './dupeMatch'
import type { NameIndexEntry } from './dupeMatch'

const entry = (name: string, kind: 'cocktail' | 'component' = 'cocktail'): NameIndexEntry => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  kind,
})

const LIBRARY = [
  entry('Daiquiri'),
  entry('Hemingway Daiquiri'),
  entry('Old Fashioned'),
  entry('Margarita'),
  entry('Simple Syrup', 'component'),
]

const names = (list: NameIndexEntry[]) => list.map((e) => e.name)

describe('normalizeRecipeName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeRecipeName('  The   Vieux   Carré!  ')).toBe('vieux carr')
    expect(normalizeRecipeName("Bee's Knees")).toBe('bee s knees')
  })

  it('drops a leading article so "The Daiquiri" is a Daiquiri', () => {
    expect(normalizeRecipeName('The Daiquiri')).toBe(normalizeRecipeName('Daiquiri'))
  })

  it('drops parentheticals', () => {
    expect(normalizeRecipeName('Martinez (1884)')).toBe('martinez')
  })

  it('keeps modifier words that a component key would strip', () => {
    // normalizeComponentName collapses these; for a DRINK name "Fresh Start" and
    // "Start" are two different drinks, so this key must keep them apart.
    expect(normalizeRecipeName('Fresh Start')).not.toBe(normalizeRecipeName('Start'))
  })
})

describe('shortlistCandidates', () => {
  it('ranks an exact name above a longer one that contains it', () => {
    const out = shortlistCandidates('Daiquiri', [], LIBRARY)
    expect(names(out)[0]).toBe('Daiquiri')
    expect(names(out)).toContain('Hemingway Daiquiri')
  })

  it('shortlists the classic a riff is built on, so it can be labelled a variation', () => {
    const out = shortlistCandidates('Oaxacan Old Fashioned', [], LIBRARY)
    expect(names(out)).toEqual(['Old Fashioned'])
  })

  it('finds a drink under another name through its aka list', () => {
    // Nothing lexical connects "Rum Sour" to "Daiquiri" — the model's aka does.
    expect(shortlistCandidates('Rum Sour', [], LIBRARY)).toEqual([])
    expect(names(shortlistCandidates('Rum Sour', ['Daiquiri'], LIBRARY))).toContain('Daiquiri')
  })

  it('returns nothing for an unrelated drink', () => {
    expect(shortlistCandidates('Negroni', [], LIBRARY)).toEqual([])
  })

  it('never crosses kinds — a syrup is not a duplicate of a cocktail', () => {
    expect(shortlistCandidates('Simple Syrup', [], LIBRARY, 'cocktail')).toEqual([])
    expect(names(shortlistCandidates('Simple Syrup', [], LIBRARY, 'component'))).toEqual([
      'Simple Syrup',
    ])
  })

  it('caps the shortlist so the prompt stays small', () => {
    const many = ['Sour', 'Whiskey Sour', 'Pisco Sour', 'Amaretto Sour', 'Gin Sour'].map((n) =>
      entry(n),
    )
    expect(shortlistCandidates('Sour', [], many, 'cocktail', 2)).toHaveLength(2)
  })

  it('ignores an empty name', () => {
    expect(shortlistCandidates('   ', [], LIBRARY)).toEqual([])
  })
})
