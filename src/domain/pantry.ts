import { db } from '../db/db'
import { normIngredient } from './availability'

// Mutations for a bar's bottle inventory. Every bottle is scoped to a `barId`
// and keyed by the normalized ingredient name, so "Fresh Lime Juice" and "lime
// juice" collapse to one entry within a bar.

export async function addToPantry(barId: string, label: string): Promise<void> {
  const name = normIngredient(label)
  if (!barId || !name) return
  await db.bottles.put({ barId, name, label: label.trim(), addedAt: Date.now() })
}

export async function removeFromPantry(barId: string, labelOrName: string): Promise<void> {
  if (!barId) return
  await db.bottles.delete([barId, normIngredient(labelOrName)])
}

export async function setInPantry(barId: string, label: string, on: boolean): Promise<void> {
  return on ? addToPantry(barId, label) : removeFromPantry(barId, label)
}

export async function bulkAddPantry(barId: string, labels: string[]): Promise<void> {
  if (!barId) return
  const now = Date.now()
  const rows = labels
    .map((l) => ({ barId, name: normIngredient(l), label: l.trim(), addedAt: now }))
    .filter((r) => r.name)
  if (rows.length) await db.bottles.bulkPut(rows)
}

/** Empty a single bar (not all bars). */
export async function clearPantry(barId: string): Promise<void> {
  if (!barId) return
  await db.bottles.where('barId').equals(barId).delete()
}
