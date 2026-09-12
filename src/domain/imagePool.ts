import { POOL_SIZES, poolPath, poolKeyForName, type PoolSizeName } from './poolKey.mjs'
import type { Recipe } from '../db/schema'

// The client-side contract around the shared pool rules (poolKey.mjs).
//
// Recipes store the REFERENCE `gen:<key>`, never a URL:
//  - one reference serves every render size (thumb/card/full resolved here),
//  - regenerating a pool entry propagates to every recipe pointing at it,
//  - backups stay small and re-import refetches from public-read Storage.
//
// Everything else — data URLs (user uploads) and legacy https URLs — renders
// untouched; this module only answers for `gen:` references.

export const GEN_PREFIX = 'gen:'

export type PoolSize = PoolSizeName

/** `gen:<key>` for a drink name, or undefined when the name is unusable. */
export function genRefFor(name: string): string | undefined {
  const key = poolKeyForName(name)
  return key ? GEN_PREFIX + key : undefined
}

export function isGenRef(image: string | undefined | null): boolean {
  return typeof image === 'string' && image.startsWith(GEN_PREFIX)
}

/** The pool key inside a `gen:` reference, or null for anything else. */
export function genRefKey(image: string | undefined | null): string | null {
  if (!image || !isGenRef(image)) return null
  return image.slice(GEN_PREFIX.length) || null
}

/**
 * What a recipe should actually render as its photo. Syrup art is drawn, not
 * generated — a pool reference on a syrup would pin whatever the photo model
 * produced (usually a served drink in a glass), so it never renders: the syrup
 * draws its bottle instead. The user's own upload always wins.
 */
export function displayImage(recipe: Recipe): string | undefined {
  if (recipe.kind === 'syrup' && isGenRef(recipe.image)) return undefined
  return recipe.image
}

/** Storage URL for one size of a pool entry. '' when inputs are unusable. */
export function poolUrl(bucket: string, key: string, size: PoolSize): string {
  if (!bucket || !key) return ''
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    poolPath(key, size),
  )}?alt=media`
}

/**
 * srcset covering all three sizes; the browser picks by rendered width × DPR,
 * so a 52px row thumb downloads ~20 KB where the old single-size catalog sent
 * the full ~700 KB frame.
 */
export function poolSrcSet(bucket: string, key: string): string {
  return (Object.keys(POOL_SIZES) as PoolSize[])
    .map((size) => `${poolUrl(bucket, key, size)} ${POOL_SIZES[size].w}w`)
    .join(', ')
}
