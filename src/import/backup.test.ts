import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { backupFilename, exportBackup, importBackup, parseBackup } from './backup'
import { importRecipe } from './importRecipe'

const daiquiri = {
  tempId: 'daiquiri',
  kind: 'cocktail' as const,
  name: 'Daiquiri',
  measureBasis: 'absolute' as const,
  spirit: 'rum',
}

async function seedLibrary(): Promise<void> {
  const syrupId = await importRecipe({
    main: {
      tempId: 'simple',
      kind: 'syrup',
      name: 'Simple Syrup',
      measureBasis: 'parts',
      ingredients: [
        { name: 'Sugar', amount: 1, unit: 'part' },
        { name: 'Water', amount: 1, unit: 'part' },
      ],
    },
  })
  await importRecipe({
    main: {
      ...daiquiri,
      ingredients: [
        { name: 'White rum', amount: 2, unit: 'oz' },
        { name: 'Lime juice', amount: 0.75, unit: 'oz' },
        { name: 'Simple syrup', amount: 0.75, unit: 'oz', recipeId: syrupId },
      ],
    },
  })
  await db.bars.add({ id: 'bar-1', name: 'My Bar', createdAt: 1 })
  await db.bottles.add({ barId: 'bar-1', name: 'white rum', label: 'White Rum', addedAt: 2 })
  localStorage.setItem('cocktail.volumePref', 'ml')
  localStorage.setItem('cocktail.assumeStaples', '0')
  localStorage.setItem('cocktail.activeBarId', 'bar-1')
}

async function wipeLibrary(): Promise<void> {
  await Promise.all([db.recipes.clear(), db.recipeLinks.clear(), db.bars.clear(), db.bottles.clear()])
  localStorage.clear()
}

beforeEach(async () => {
  await wipeLibrary()
})

describe('exportBackup', () => {
  it('captures every store plus the portable settings', async () => {
    await seedLibrary()

    const backup = await exportBackup()

    expect(backup.app).toBe('cocktail')
    expect(backup.version).toBe(1)
    // Daiquiri + its Simple Syrup component.
    expect(backup.data.recipes).toHaveLength(2)
    expect(backup.data.recipeLinks).toHaveLength(1)
    expect(backup.data.bars).toHaveLength(1)
    expect(backup.data.bottles).toHaveLength(1)
    expect(backup.settings).toEqual({
      'cocktail.volumePref': 'ml',
      'cocktail.assumeStaples': '0',
      'cocktail.activeBarId': 'bar-1',
    })
  })

  it('never writes the Gemini API key into the file', async () => {
    await seedLibrary()
    localStorage.setItem('cocktail.geminiKey', 'AIzaSyNOT-A-REAL-KEY')

    const backup = await exportBackup()

    expect(backup.settings['cocktail.geminiKey']).toBeUndefined()
    expect(JSON.stringify(backup)).not.toContain('AIzaSyNOT-A-REAL-KEY')
  })
})

describe('round trip', () => {
  it('restores recipes, links, bars, bottles and settings onto an empty database', async () => {
    await seedLibrary()
    const json = JSON.stringify(await exportBackup())
    await wipeLibrary()

    await importBackup(parseBackup(json))

    const recipes = await db.recipes.toArray()
    expect(recipes.map((r) => r.name).sort()).toEqual(['Daiquiri', 'Simple Syrup'])

    // The cross-link has to survive verbatim, or "Used in" back-links and
    // the makeable check silently lose the syrup relationship.
    const drink = recipes.find((r) => r.kind === 'cocktail')!
    const syrup = recipes.find((r) => r.kind === 'syrup')!
    const linked = drink.ingredients.find((i) => i.recipeId)
    expect(linked?.recipeId).toBe(syrup.id)
    const links = await db.recipeLinks.toArray()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ parentId: drink.id, childId: syrup.id })

    expect(await db.bottles.toArray()).toEqual([
      { barId: 'bar-1', name: 'white rum', label: 'White Rum', addedAt: 2 },
    ])
    expect(localStorage.getItem('cocktail.volumePref')).toBe('ml')
    expect(localStorage.getItem('cocktail.activeBarId')).toBe('bar-1')
  })

  it('replaces the existing library rather than merging into it', async () => {
    const empty = JSON.stringify(await exportBackup())
    await seedLibrary()

    await importBackup(parseBackup(empty))

    expect(await db.recipes.count()).toBe(0)
    expect(await db.bottles.count()).toBe(0)
  })

  it('ignores unknown settings keys in the file', async () => {
    await importBackup(
      parseBackup(
        JSON.stringify({
          app: 'cocktail',
          version: 1,
          data: {},
          settings: { 'cocktail.geminiKey': 'AIzaInjected', 'evil.key': '1' },
        }),
      ),
    )

    expect(localStorage.getItem('cocktail.geminiKey')).toBeNull()
    expect(localStorage.getItem('evil.key')).toBeNull()
  })
})

describe('parseBackup', () => {
  it('rejects a bad file before anything is written', async () => {
    await seedLibrary()

    expect(() => parseBackup('not json')).toThrow(/valid JSON/)
    expect(() => parseBackup('{"app":"something-else","version":1}')).toThrow(/not a Cocktails/)
    expect(() => parseBackup('{"app":"cocktail","version":99,"data":{}}')).toThrow(/newer version/)
    expect(() => parseBackup('{"app":"cocktail","version":1}')).toThrow(/no data/)
    expect(() => parseBackup('{"app":"cocktail","version":1,"data":{"recipes":"x"}}')).toThrow(
      /damaged/,
    )

    // The library is untouched by every one of those failures.
    expect(await db.recipes.count()).toBe(2)
  })

  it('tolerates a backup missing a store entirely', () => {
    const parsed = parseBackup('{"app":"cocktail","version":1,"data":{"recipes":[]}}')
    expect(parsed.data.bars).toEqual([])
    expect(parsed.data.bottles).toEqual([])
  })
})

describe('backupFilename', () => {
  it('is dated so successive exports do not overwrite each other in Downloads', () => {
    expect(backupFilename(Date.UTC(2026, 7, 9))).toBe('cocktails-backup-2026-08-09.json')
  })
})
