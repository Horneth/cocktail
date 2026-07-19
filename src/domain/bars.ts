import { db } from '../db/db'
import type { Bar } from '../db/schema'
import { newId } from './ids'

// CRUD for named bars. The active bar is tracked in localStorage
// (useSettings.useActiveBarId); this module only owns the bar records and their
// bottles.

/** Guarantee at least one bar exists (fresh installs skip the v3 migration). */
export async function ensureDefaultBar(): Promise<void> {
  if ((await db.bars.count()) === 0) {
    await db.bars.add({ id: newId(), name: 'My Bar', createdAt: Date.now() })
  }
}

/** Create a bar and return its id. */
export async function createBar(name: string): Promise<string> {
  const bar: Bar = { id: newId(), name: name.trim() || 'New bar', createdAt: Date.now() }
  await db.bars.add(bar)
  return bar.id
}

export async function renameBar(id: string, name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  await db.bars.update(id, { name: n })
}

/** Delete a bar and all its bottles. Refuses to remove the last remaining bar. */
export async function deleteBar(id: string): Promise<void> {
  await db.transaction('rw', db.bars, db.bottles, async () => {
    if ((await db.bars.count()) <= 1) throw new Error('Keep at least one bar.')
    await db.bottles.where('barId').equals(id).delete()
    await db.bars.delete(id)
  })
}
