import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { deleteRecipe } from '../import/importRecipe'
import { MIXER_SEEDS, classicSeeds, seedClassics } from './seed'
import { poolKeyForName } from '../domain/poolKey.mjs'
import { KNOWN_SPIRITS } from '../domain/spirits'
import classics from '../../scripts/classics.json'

// The seed library is curated content with provenance — these tests keep the
// seeds, the image pool and the curated-keys set from drifting apart, and pin
// the one-time upgrade's behaviour.

const SEED_IMPORTS = [...MIXER_SEEDS, ...classicSeeds('seed-simple-syrup', 'seed-orgeat')]
const COCKTAIL_SEEDS = SEED_IMPORTS.filter((s) => s.main.kind === 'cocktail')

describe('seed integrity', () => {
  it('names are unique', () => {
    const names = SEED_IMPORTS.map((s) => s.main.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every cocktail maps to a curated pool key, so its image exists or is coming', () => {
    const curated = new Set(classics.map((c) => poolKeyForName(c.name)))
    for (const seed of COCKTAIL_SEEDS) {
      const key = poolKeyForName(seed.main.name)
      expect(curated.has(key), `${seed.main.name} → ${key}`).toBe(true)
    }
  })

  it('spirits are known tiles and glassware/methods sit in the vocabulary', () => {
    for (const seed of COCKTAIL_SEEDS) {
      const { spirit, glassware, method, measureBasis } = seed.main
      expect(spirit, seed.main.name).toBeTruthy()
      expect(KNOWN_SPIRITS, `${seed.main.name}: ${spirit}`).toContain(spirit)
      expect(glassware, seed.main.name).toBeTruthy()
      expect(method, seed.main.name).toBeTruthy()
      expect(measureBasis).toBe('absolute')
    }
  })

  it('gen refs are present on every cocktail', () => {
    for (const seed of COCKTAIL_SEEDS) {
      expect(seed.main.image, seed.main.name).toMatch(/^gen:/)
    }
  })
})

describe('seedClassics', () => {
  beforeEach(async () => {
    await db.recipes.clear()
    await db.recipeLinks.clear()
    localStorage.clear()
  })

  it('seeds the full set on a fresh store', async () => {
    await seedClassics()
    const all = await db.recipes.toArray()
    expect(all).toHaveLength(SEED_IMPORTS.length)
    expect(all.filter((r) => r.kind === 'syrup')).toHaveLength(2)
  })

  it('skips recipes that already exist (the upgrade path)', async () => {
    await seedClassics()
    const first = (await db.recipes.toArray()).map((r) => r.id)
    // A device that already had the original four: names present, flag not yet
    // set. The upgrade must add only what's missing, never duplicate.
    localStorage.clear()
    await seedClassics()
    const second = await db.recipes.count()
    expect(second).toBe(first.length)
  })

  it('respects deletions once the upgrade has run', async () => {
    await seedClassics()
    const mojito = (await db.recipes.toArray()).find((r) => r.name === 'Mojito')!
    await deleteRecipe(mojito.id)

    await seedClassics() // a later boot: the flag prevents any re-seed

    expect((await db.recipes.toArray()).some((r) => r.name === 'Mojito')).toBe(false)
  })

  it('wires cross-links so back-links resolve from day one', async () => {
    await seedClassics()
    const rows = await db.recipes.toArray()
    const byName = new Map(rows.map((r) => [r.name, r]))

    const maiTai = byName.get('Mai Tai')!
    const orgeatLine = maiTai.ingredients.find((i) => i.name === 'Orgeat')!
    expect(orgeatLine.recipeId).toBe(byName.get('Orgeat')!.id)

    const espresso = byName.get('Espresso Martini')!
    const syrupLine = espresso.ingredients.find((i) => i.name === 'Simple Syrup')!
    expect(syrupLine.recipeId).toBe(byName.get('Simple Syrup')!.id)

    const links = await db.recipeLinks.toArray()
    // Mai Tai carries two links (Orgeat + Simple Syrup) — assert both, not
    // whichever happens to sort first.
    const maiTaiLinks = links.filter((l) => l.parentId === maiTai.id)
    expect(maiTaiLinks).toHaveLength(2)
    expect(maiTaiLinks.map((l) => l.childId).sort()).toEqual(
      [byName.get('Orgeat')!.id, byName.get('Simple Syrup')!.id].sort(),
    )
  })

  it('only runs once per install (flag set on success)', async () => {
    await seedClassics()
    localStorage.setItem('cocktail.seedClassics', '1')
    await deleteRecipe((await db.recipes.toArray())[0].id)
    const count = await db.recipes.count()

    await seedClassics()

    expect(await db.recipes.count()).toBe(count)
  })
})