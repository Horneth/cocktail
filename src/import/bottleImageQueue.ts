import { isCloudAIConfigured, FEATURES } from '../config'
import { attachBottleImage, markBottleImageFailed, markBottleImagePending } from '../domain/pantry'
import { bottlePoolKeyFor } from '../domain/bottlePool.mjs'
import { bottleGenRefFor } from '../domain/bottleImage'
import type { PantryItem } from '../db/schema'
import { firebaseGenerateBottleImage } from './bottleImageGen'
import { ImageLimitError } from './imageLimit'

export function queueBottleImageGeneration(rows: PantryItem[]): void {
  if (!FEATURES.cloudAI || !isCloudAIConfigured() || localStorage.getItem('cocktail.signedIn') !== '1') return
  const unique = new Map<string, PantryItem>()
  for (const row of rows) {
    const key = bottlePoolKeyFor(row.label, row.category)
    if (key && !unique.has(`${row.barId}:${row.name}`)) unique.set(`${row.barId}:${row.name}`, row)
  }
  for (const row of unique.values()) void generate(row)
}

async function generate(row: PantryItem): Promise<void> {
  const key = bottlePoolKeyFor(row.label, row.category)
  if (!key) return
  const ref = bottleGenRefFor(key)
  if (row.image === ref && (row.imageStatus === 'done' || row.imageStatus === 'pending')) return
  await markBottleImagePending(row.barId, row.name, ref)
  try {
    const result = await firebaseGenerateBottleImage({ name: row.label, category: row.category, brand: row.brand })
    if (result.key !== key) return
    await attachBottleImage(row.barId, row.name, ref)
  } catch (error) {
    await markBottleImageFailed(row.barId, row.name, ref, error instanceof ImageLimitError ? 'daily-limit' : undefined)
  }
}
