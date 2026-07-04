import { describe, expect, it } from 'vitest'
import { parseRecipeText } from './parseRecipeText'

// A realistic Anders-Erickson-style description: title, ingredient lines with
// mixed amount formats, a topper with no amount, a garnish line, a labelled
// sub-recipe with a ratio, and trailing noise (chapters, gear, socials).
const TOM_COLLINS = `The Tom Collins is a refreshing classic. Here's how I make mine.

Tom Collins
2 oz Gin
1 oz Lemon Juice
1/2 oz Semi-Rich Simple Syrup (1.5:1)
Club Soda
Garnish: Lemon wheel and cherry

Shake the first three ingredients with ice, strain into a Collins glass over fresh ice, top with club soda.

Semi-Rich Simple Syrup
1.5 parts sugar
1 part water

CHAPTERS:
0:00 Intro
1:12 Making the drink

GEAR I USE:
Shaker: https://amazon.com/xyz
Follow me on Instagram: @anderserickson`

describe('parseRecipeText — Tom Collins', () => {
  const r = parseRecipeText(TOM_COLLINS)

  it('extracts the cocktail name', () => {
    expect(r.main.name).toBe('Tom Collins')
    expect(r.ok).toBe(true)
  })

  it('parses ingredient amounts in oz, fractions and decimals', () => {
    const gin = r.main.ingredients.find((i) => i.name === 'Gin')
    const lemon = r.main.ingredients.find((i) => i.name === 'Lemon Juice')
    const syrup = r.main.ingredients.find((i) => i.name.includes('Semi-Rich Simple Syrup'))
    expect(gin).toMatchObject({ amount: 2, unit: 'oz' })
    expect(lemon).toMatchObject({ amount: 1, unit: 'oz' })
    expect(syrup).toMatchObject({ amount: 0.5, unit: 'oz' })
  })

  it('captures a no-amount topper', () => {
    const soda = r.main.ingredients.find((i) => i.name === 'Club Soda')
    expect(soda).toMatchObject({ amount: null, unit: 'top' })
  })

  it('captures the garnish', () => {
    expect(r.main.garnish).toBe('Lemon wheel and cherry')
  })

  it('detects the method and spirit', () => {
    expect(r.main.method).toBe('Shake')
    expect(r.main.spirit).toBe('gin')
  })

  it('keeps method prose but drops the intro sentence before the recipe', () => {
    expect(r.main.instructions).toMatch(/strain into a Collins glass/i)
    expect(r.main.instructions).not.toMatch(/refreshing classic/i)
  })

  it('extracts the sub-recipe as a parts component', () => {
    expect(r.components).toHaveLength(1)
    const syrup = r.components[0]
    expect(syrup.name).toBe('Semi-Rich Simple Syrup')
    expect(syrup.kind).toBe('component')
    expect(syrup.measureBasis).toBe('parts')
    expect(syrup.ingredients).toMatchObject([
      { amount: 1.5, unit: 'part', name: 'sugar' },
      { amount: 1, unit: 'part', name: 'water' },
    ])
  })

  it('cross-links the syrup ingredient to the component', () => {
    const syrupIng = r.main.ingredients.find((i) => i.name.includes('Simple Syrup'))
    expect(syrupIng?.subRecipeRef).toBe(r.components[0].tempId)
  })

  it('strips noise (chapters, gear, socials, links)', () => {
    const names = r.main.ingredients.map((i) => i.name).join('|')
    expect(names).not.toMatch(/amazon|instagram|chapters/i)
  })
})

const OLD_FASHIONED = `Old Fashioned
2 oz Bourbon
¼ oz Rich Simple Syrup
2 dashes Angostura Bitters
1 dash Orange Bitters
Garnish: Orange peel

Stir with ice and strain over a large cube.

Rich Simple Syrup
2 parts sugar
1 part water`

describe('parseRecipeText — Old Fashioned', () => {
  const r = parseRecipeText(OLD_FASHIONED)

  it('handles unicode fractions and dashes', () => {
    const syrup = r.main.ingredients.find((i) => i.name.includes('Rich Simple Syrup'))
    const ango = r.main.ingredients.find((i) => i.name.includes('Angostura'))
    expect(syrup).toMatchObject({ amount: 0.25, unit: 'oz' })
    expect(ango).toMatchObject({ amount: 2, unit: 'dash' })
  })

  it('detects stir method', () => {
    expect(r.main.method).toBe('Stir')
  })

  it('links rich simple syrup to its component', () => {
    const syrupIng = r.main.ingredients.find((i) => i.name.includes('Rich Simple Syrup'))
    expect(syrupIng?.subRecipeRef).toBe(r.components[0].tempId)
    expect(r.components[0].measureBasis).toBe('parts')
  })
})

describe('parseRecipeText — resilience', () => {
  it('never throws on empty or junk input', () => {
    expect(() => parseRecipeText('')).not.toThrow()
    expect(parseRecipeText('').ok).toBe(false)
    expect(() => parseRecipeText('just some random words here')).not.toThrow()
  })

  it('reports ok=false when nothing parseable is found', () => {
    expect(parseRecipeText('check out my channel\nsubscribe now').ok).toBe(false)
  })
})
