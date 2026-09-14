import { db } from '../db/db'
import type { PantryItem } from '../db/schema'
import { normIngredient } from './availability'
import { categoryForName } from './spiritCategory'

// Mutations for a bar's bottle inventory. Every bottle is scoped to a `barId`
// and keyed by the normalized ingredient name, so "Fresh Lime Juice" and "lime
// juice" collapse to one entry within a bar.
//
// Writers may pass a bare label (the common case — a tick in a list) or a
// BottleInput carrying what a scan or the user told us about the bottle. The
// category is inferred here when it wasn't supplied, so it's stored once
// instead of being re-derived on every render.

export interface BottleInput {
  label: string
  category?: string
  brand?: string
}

type BottleLike = string | BottleInput

function toRow(barId: string, input: BottleLike, addedAt: number): PantryItem | null {
  const { label, category, brand }: BottleInput = typeof input === 'string' ? { label: input } : input
  const name = normIngredient(label)
  if (!name) return null
  const resolved = category ?? categoryForName(label)
  return {
    barId,
    name,
    label: label.trim(),
    addedAt,
    ...(resolved ? { category: resolved } : {}),
    ...(brand?.trim() ? { brand: brand.trim() } : {}),
  }
}

export async function addToPantry(barId: string, input: BottleLike): Promise<void> {
  if (!barId) return
  const row = toRow(barId, input, Date.now())
  if (!row) return
  const existing = await db.bottles.get([barId, row.name])
  await db.bottles.put(existing ? { ...row, image: existing.image, imageStatus: existing.imageStatus, imageError: existing.imageError } : row)
}

export async function removeFromPantry(barId: string, labelOrName: string): Promise<void> {
  if (!barId) return
  await db.bottles.delete([barId, normIngredient(labelOrName)])
}

export async function setInPantry(barId: string, input: BottleLike, on: boolean): Promise<void> {
  if (on) return addToPantry(barId, input)
  return removeFromPantry(barId, typeof input === 'string' ? input : input.label)
}

export async function bulkAddPantry(barId: string, inputs: BottleLike[]): Promise<PantryItem[]> {
  if (!barId) return []
  const now = Date.now()
  const rows = inputs.map((i) => toRow(barId, i, now)).filter((r): r is PantryItem => r !== null)
  if (rows.length) {
    const existing = await db.bottles.bulkGet(rows.map((row) => [barId, row.name] as [string, string]))
    await db.bottles.bulkPut(
      rows.map((row, index) => {
        const previous = existing[index]
        return previous
          ? { ...row, image: previous.image, imageStatus: previous.imageStatus, imageError: previous.imageError }
          : row
      }),
    )
  }
  return rows
}

export async function markBottleImagePending(
  barId: string,
  name: string,
  image: string,
): Promise<void> {
  const existing = await db.bottles.get([barId, name])
  if (!existing) return
  await db.bottles.put({ ...existing, image, imageStatus: 'pending', imageError: undefined })
}

export async function attachBottleImage(barId: string, name: string, image: string): Promise<void> {
  const existing = await db.bottles.get([barId, name])
  if (!existing || existing.imageStatus !== 'pending' || existing.image !== image) return
  await db.bottles.put({ ...existing, imageStatus: 'done', imageError: undefined })
}

export async function markBottleImageFailed(
  barId: string,
  name: string,
  image: string,
  error?: 'daily-limit',
): Promise<void> {
  const existing = await db.bottles.get([barId, name])
  if (!existing || existing.imageStatus !== 'pending' || existing.image !== image) return
  await db.bottles.put({ ...existing, imageStatus: 'failed', ...(error ? { imageError: error } : {}) })
}

/**
 * Edit a bottle already on the shelf. `label` is deliberately NOT patchable: it
 * derives the primary key, so renaming is a remove + add, not an update.
 */
export async function updateBottle(
  barId: string,
  name: string,
  patch: Partial<Pick<PantryItem, 'category' | 'brand' | 'image' | 'imageStatus' | 'imageError'>>,
): Promise<void> {
  if (!barId || !name) return
  const existing = await db.bottles.get([barId, name])
  if (!existing) return
  await db.bottles.put({ ...existing, ...patch })
}

/** Empty a single bar (not all bars). */
export async function clearPantry(barId: string): Promise<void> {
  if (!barId) return
  await db.bottles.where('barId').equals(barId).delete()
}
