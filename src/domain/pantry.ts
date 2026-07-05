import { db } from '../db/db'
import { normIngredient } from './availability'

// Mutations for the "My Bar" inventory. Keyed by the normalized ingredient name
// so "Fresh Lime Juice" and "lime juice" collapse to one entry.

export async function addToPantry(label: string): Promise<void> {
  const name = normIngredient(label)
  if (!name) return
  await db.pantry.put({ name, label: label.trim(), addedAt: Date.now() })
}

export async function removeFromPantry(labelOrName: string): Promise<void> {
  await db.pantry.delete(normIngredient(labelOrName))
}

export async function setInPantry(label: string, on: boolean): Promise<void> {
  return on ? addToPantry(label) : removeFromPantry(label)
}

export async function bulkAddPantry(labels: string[]): Promise<void> {
  const now = Date.now()
  const rows = labels
    .map((l) => ({ name: normIngredient(l), label: l.trim(), addedAt: now }))
    .filter((r) => r.name)
  if (rows.length) await db.pantry.bulkPut(rows)
}

export async function clearPantry(): Promise<void> {
  await db.pantry.clear()
}
