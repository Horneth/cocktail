import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { addToPantry, bulkAddPantry, setInPantry, updateBottle } from './pantry'

const BAR = 'bar-1'
const get = (name: string) => db.bottles.get([BAR, name])

describe('bottle records', () => {
  beforeEach(async () => {
    await db.bottles.clear()
  })

  it('still accepts a bare label', async () => {
    await addToPantry(BAR, 'White rum')
    expect((await get('white rum'))?.label).toBe('White rum')
  })

  it('infers the category at write time when none is given', async () => {
    await addToPantry(BAR, 'Woodford Reserve')
    expect((await get('woodford reserve'))?.category).toBe('whiskey')
  })

  it('keeps a supplied category over the inferred one', async () => {
    // categoryForName reads "Plantation" as a rum; if a scan or the user says
    // otherwise, their answer wins.
    await addToPantry(BAR, { label: 'Plantation Pineapple', category: 'liqueur', brand: 'Plantation' })
    const row = await get('plantation pineapple')
    expect(row?.category).toBe('liqueur')
    expect(row?.brand).toBe('Plantation')
  })

  it('omits category and brand entirely when neither is known', async () => {
    await addToPantry(BAR, 'Orgeat')
    const row = await get('orgeat')
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty('category')
    expect(row).not.toHaveProperty('brand')
  })

  it('bulkAddPantry mixes bare labels and full records, dropping empties', async () => {
    await bulkAddPantry(BAR, ['Gin', { label: 'Tanqueray No. Ten', brand: 'Tanqueray' }, '   '])
    const rows = await db.bottles.where('barId').equals(BAR).toArray()
    expect(rows.map((r) => r.name).sort()).toEqual(['gin', 'tanqueray no ten'])
    expect(rows.find((r) => r.name === 'tanqueray no ten')?.brand).toBe('Tanqueray')
  })

  it('setInPantry removes by the label of a full record', async () => {
    await addToPantry(BAR, { label: 'Green Chartreuse', category: 'liqueur' })
    await setInPantry(BAR, { label: 'Green Chartreuse' }, false)
    expect(await get('green chartreuse')).toBeUndefined()
  })

  it('updateBottle patches a stocked bottle without touching its key', async () => {
    await addToPantry(BAR, 'Plantation 3 Stars')
    await updateBottle(BAR, 'plantation 3 stars', { category: 'rum', brand: 'Plantation' })
    const row = await get('plantation 3 stars')
    expect(row?.category).toBe('rum')
    expect(row?.brand).toBe('Plantation')
    expect(row?.label).toBe('Plantation 3 Stars')
  })

  it('updateBottle is a no-op for a bottle that is not stocked', async () => {
    await updateBottle(BAR, 'campari', { category: 'liqueur' })
    expect(await get('campari')).toBeUndefined()
  })
})
