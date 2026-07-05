import { describe, expect, it } from 'vitest'
import type { Unit } from '../db/schema'
import { convert, formatAmount, formatNumber, isConvertible, toPreferred, unitDef } from './units'

describe('unit lookups tolerate unknown/legacy units (never throw → never blank the screen)', () => {
  const bogus = 'furlong' as Unit
  it('unitDef falls back for an unknown unit', () => {
    expect(unitDef(bogus)).toBe(unitDef('each'))
  })
  it('formatAmount / convert / isConvertible do not throw on an unknown unit', () => {
    expect(() => formatAmount(2, bogus)).not.toThrow()
    expect(() => convert(2, bogus, 'oz')).not.toThrow()
    expect(convert(2, bogus, 'oz')).toBe(2) // non-convertible → unchanged
    expect(isConvertible(bogus)).toBe(false)
  })
})

describe('convert', () => {
  it('converts oz to ml at the 30ml bar convention', () => {
    expect(convert(1, 'oz', 'ml')).toBe(30)
    expect(convert(0.75, 'oz', 'ml')).toBe(22.5)
  })

  it('converts ml to oz', () => {
    expect(convert(30, 'ml', 'oz')).toBe(1)
  })

  it('leaves non-convertible units (parts, countables) unchanged', () => {
    expect(convert(1, 'part', 'ml')).toBe(1)
    expect(convert(2, 'wedge', 'oz')).toBe(2)
  })

  it('knows which units are convertible', () => {
    expect(isConvertible('oz')).toBe(true)
    expect(isConvertible('dash')).toBe(true) // dash has an ml factor
    expect(isConvertible('part')).toBe(false)
    expect(isConvertible('wedge')).toBe(false)
  })
})

describe('formatNumber', () => {
  it('renders bar quarters as vulgar fractions', () => {
    expect(formatNumber(0.75, 'oz')).toBe('¾')
    expect(formatNumber(0.5, 'oz')).toBe('½')
    expect(formatNumber(1.5, 'oz')).toBe('1½')
    expect(formatNumber(2, 'oz')).toBe('2')
  })

  it('renders ml as plain decimals', () => {
    expect(formatNumber(22.5, 'ml')).toBe('22.5')
    expect(formatNumber(30, 'ml')).toBe('30')
  })
})

describe('formatAmount', () => {
  it('pluralizes dashes', () => {
    expect(formatAmount(2, 'dash')).toBe('2 dashes')
    expect(formatAmount(1, 'dash')).toBe('1 dash')
  })

  it('renders to-taste (null) as just the unit label', () => {
    expect(formatAmount(null, 'top')).toBe('top')
  })

  it('formats a standard oz pour', () => {
    expect(formatAmount(0.75, 'oz')).toBe('¾ oz')
  })
})

describe('toPreferred', () => {
  it('swaps main volume units to the preference', () => {
    expect(toPreferred(1, 'oz', 'ml')).toEqual({ amount: 30, unit: 'ml' })
    expect(toPreferred(30, 'ml', 'oz')).toEqual({ amount: 1, unit: 'oz' })
  })

  it('leaves dashes and parts alone', () => {
    expect(toPreferred(2, 'dash', 'oz')).toEqual({ amount: 2, unit: 'dash' })
    expect(toPreferred(1, 'part', 'ml')).toEqual({ amount: 1, unit: 'part' })
  })
})
