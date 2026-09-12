import { describe, expect, it } from 'vitest'
import { BOTTLE_PATHS, BOTTLE_SHAPES, SHAPE_FOR, spiritVisual } from './spiritVisual'
import { SPIRIT_ORDER } from './spirits'

// Every key that can reach spiritVisual: the mosaic order, the mixer kind and
// the special tiles.
const ALL_KEYS = [...SPIRIT_ORDER, 'syrup', 'all', 'favorites']

describe('bottle silhouettes', () => {
  it('maps every known tile key to a defined shape with a path', () => {
    for (const key of ALL_KEYS) {
      const v = spiritVisual(key)
      expect(BOTTLE_SHAPES).toContain(v.silhouette)
      expect(BOTTLE_PATHS[v.silhouette]).toMatch(/^M[\d.]/)
    }
  })

  it('falls back to the generic bottle for unknown custom spirits', () => {
    expect(spiritVisual('pisco sour').silhouette).toBe('generic')
    expect(spiritVisual('other').silhouette).toBe('generic')
  })

  it('keeps the family mappings where they belong', () => {
    expect(SHAPE_FOR.whiskey).toBe('square')
    expect(SHAPE_FOR.rum).toBe('round')
    expect(SHAPE_FOR.wine).toBe('wine')
    expect(SHAPE_FOR.tequila).toBe('squat')
    expect(SHAPE_FOR.cognac).toBe('decanter')
    expect(SHAPE_FOR.syrup).toBe('jar')
    expect(SHAPE_FOR.gin).toBe('tall')
  })

  it('covers every shape the component can be asked to draw', () => {
    expect(new Set(BOTTLE_SHAPES).size).toBe(BOTTLE_SHAPES.length)
    for (const shape of BOTTLE_SHAPES) {
      expect(BOTTLE_PATHS[shape]).toBeTruthy()
    }
  })
})