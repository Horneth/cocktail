import { describe, expect, it } from 'vitest'
import { bottlePoolKeyFor } from './bottlePool.mjs'

describe('bottlePoolKeyFor', () => {
  it('includes category and normalizes casing and accents', () => {
    expect(bottlePoolKeyFor('Kahlúa', 'liqueur')).toBe('liqueur-kahlua')
  })

  it('shares tawny and ruby port while preserving white and red port', () => {
    expect(bottlePoolKeyFor('Tawny Port', 'wine')).toBe(bottlePoolKeyFor('Ruby Port', 'wine'))
    expect(bottlePoolKeyFor('White Port', 'wine')).not.toBe(bottlePoolKeyFor('Red Port', 'wine'))
  })

  it('keeps chartreuse colors distinct and translates common names', () => {
    expect(bottlePoolKeyFor('Chartreuse Verte', 'liqueur')).toBe(bottlePoolKeyFor('Green Chartreuse', 'liqueur'))
    expect(bottlePoolKeyFor('Green Chartreuse', 'liqueur')).not.toBe(bottlePoolKeyFor('Yellow Chartreuse', 'liqueur'))
  })
})
