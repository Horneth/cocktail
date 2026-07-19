import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { createBar, deleteBar, ensureDefaultBar, renameBar } from './bars'
import { addToPantry, bulkAddPantry, clearPantry, removeFromPantry } from './pantry'

async function have(barId: string): Promise<Set<string>> {
  const rows = await db.bottles.where('barId').equals(barId).toArray()
  return new Set(rows.map((r) => r.name))
}

describe('bars + bar-scoped pantry', () => {
  beforeEach(async () => {
    await db.bars.clear()
    await db.bottles.clear()
  })

  it('ensureDefaultBar creates exactly one "My Bar" and is idempotent', async () => {
    await ensureDefaultBar()
    await ensureDefaultBar()
    const bars = await db.bars.toArray()
    expect(bars).toHaveLength(1)
    expect(bars[0].name).toBe('My Bar')
  })

  it('keeps bottles isolated between bars', async () => {
    const a = await createBar('My Bar')
    const b = await createBar("Friend's")
    await addToPantry(a, 'White rum')
    await addToPantry(b, 'Gin')
    expect(await have(a)).toEqual(new Set(['white rum']))
    expect(await have(b)).toEqual(new Set(['gin']))
  })

  it('the same bottle can live in two bars independently', async () => {
    const a = await createBar('A')
    const b = await createBar('B')
    await addToPantry(a, 'Gin')
    await addToPantry(b, 'Gin')
    await removeFromPantry(a, 'Gin')
    expect(await have(a)).toEqual(new Set())
    expect(await have(b)).toEqual(new Set(['gin']))
  })

  it('clearPantry empties only the target bar', async () => {
    const a = await createBar('A')
    const b = await createBar('B')
    await bulkAddPantry(a, ['Gin', 'Rum'])
    await bulkAddPantry(b, ['Vodka'])
    await clearPantry(a)
    expect(await have(a)).toEqual(new Set())
    expect(await have(b)).toEqual(new Set(['vodka']))
  })

  it('deleteBar removes its bottles and refuses to delete the last bar', async () => {
    const a = await createBar('A')
    const b = await createBar('B')
    await addToPantry(b, 'Gin')
    await deleteBar(b)
    expect(await db.bars.get(b)).toBeUndefined()
    expect(await db.bottles.where('barId').equals(b).count()).toBe(0)
    await expect(deleteBar(a)).rejects.toThrow()
  })

  it('renameBar updates the name', async () => {
    const a = await createBar('A')
    await renameBar(a, 'Beach house')
    expect((await db.bars.get(a))?.name).toBe('Beach house')
  })
})
