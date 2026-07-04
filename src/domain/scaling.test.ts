import { describe, expect, it } from 'vitest'
import type { Ingredient } from '../db/schema'
import { scaleFactor, scaledIngredient, type ScaleSettings } from './scaling'

const rum: Ingredient = { id: 'a', name: 'White rum', amount: 2, unit: 'oz' }
const lime: Ingredient = { id: 'b', name: 'Lime juice', amount: 0.75, unit: 'oz' }
const garnish: Ingredient = { id: 'c', name: 'Lime wheel', amount: null, unit: 'wedge' }

const absolute = (targetServings: number): ScaleSettings => ({
  measureBasis: 'absolute',
  baseServings: 1,
  targetServings,
})

describe('scaleFactor', () => {
  it('is target/base for absolute recipes', () => {
    expect(scaleFactor(absolute(2))).toBe(2)
    expect(scaleFactor({ measureBasis: 'absolute', baseServings: 2, targetServings: 3 })).toBe(1.5)
  })

  it('is 1 for parts recipes', () => {
    expect(scaleFactor({ measureBasis: 'parts', baseServings: 1, targetServings: 5 })).toBe(1)
  })
})

describe('scaledIngredient', () => {
  it('scales absolute amounts non-destructively', () => {
    const s = absolute(2)
    expect(scaledIngredient(rum, s)).toEqual({ amount: 4, unit: 'oz' })
    expect(scaledIngredient(lime, s)).toEqual({ amount: 1.5, unit: 'oz' })
    // original object untouched
    expect(rum.amount).toBe(2)
  })

  it('passes through to-taste/garnish amounts', () => {
    expect(scaledIngredient(garnish, absolute(3))).toEqual({ amount: null, unit: 'wedge' })
  })

  it('applies a per-ingredient override in place of the scaled value', () => {
    expect(scaledIngredient(lime, absolute(2), 1)).toEqual({ amount: 1, unit: 'oz' })
  })

  it('converts parts to ml when a per-part volume is given', () => {
    const sugar: Ingredient = { id: 'd', name: 'Sugar', amount: 1, unit: 'part' }
    const s: ScaleSettings = { measureBasis: 'parts', baseServings: 1, targetServings: 1, mlPerPart: 100 }
    expect(scaledIngredient(sugar, s)).toEqual({ amount: 100, unit: 'ml' })
  })

  it('shows raw ratio when no per-part volume is given', () => {
    const sugar: Ingredient = { id: 'd', name: 'Sugar', amount: 2, unit: 'part' }
    const s: ScaleSettings = { measureBasis: 'parts', baseServings: 1, targetServings: 1 }
    expect(scaledIngredient(sugar, s)).toEqual({ amount: 2, unit: 'part' })
  })
})
