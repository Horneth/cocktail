import { describe, expect, it } from 'vitest'
import { BOTTLE_SHAPES } from './spiritVisual'
import { syrupArt } from './syrupArt'

describe('syrupArt', () => {
  it('colors the well-known syrups after their real liquids', () => {
    expect(syrupArt('Grenadine').fill).toBe('#b02a33')
    expect(syrupArt('Orgeat').fill).toBe('#e9dcc4')
    expect(syrupArt('Demerara Syrup').fill).toBe('#b5722e')
    expect(syrupArt('Honey Syrup').fill).toBe('#d9a441')
  })

  it('reads "Rich Simple Syrup (2:1)" as simple syrup — translucent pale straw', () => {
    const art = syrupArt('Rich Simple Syrup (2:1)')
    expect(art.fill).toBe('hsl(46 60% 72% / .55)')
  })

  it('splits near-identical families: blue curaçao stays blue, curaçao goes orange', () => {
    expect(syrupArt('Blue Curaçao Syrup').fill).toBe('#2f7fc0')
    expect(syrupArt('Curaçao Syrup').fill).toBe('#d97a2b')
  })

  it('is deterministic per name, including unknown custom syrups', () => {
    expect(syrupArt('Lavender Syrup')).toEqual(syrupArt('Lavender Syrup'))
    expect(syrupArt('Hibiscus Syrup').fill).toBe('#a03254')
  })

  it('always returns one of the generic bottle silhouettes, stable per name', () => {
    for (const name of ['Simple Syrup', 'Grenadine', 'Orgeat', 'Some Custom Thing']) {
      const a = syrupArt(name)
      expect(BOTTLE_SHAPES).toContain(a.shape)
      expect(a.shape).toBe(syrupArt(name).shape)
    }
  })
})