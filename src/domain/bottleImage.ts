import { firebaseConfig } from '../config'
import { bottlePoolPath } from './bottlePool.mjs'

export const BOTTLE_GEN_PREFIX = 'bottle:'

export function bottleGenRefFor(key: string): string {
  return `${BOTTLE_GEN_PREFIX}${key}`
}

export function bottleGenKey(ref: string | undefined | null): string | null {
  return ref?.startsWith(BOTTLE_GEN_PREFIX) ? ref.slice(BOTTLE_GEN_PREFIX.length) || null : null
}

export function bottlePoolUrl(ref: string | undefined | null, version?: string): string {
  const key = bottleGenKey(ref)
  const bucket = firebaseConfig.storageBucket
  if (!key || !bucket) return ''
  const cacheBust = version ? `&v=${encodeURIComponent(version)}` : ''
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    bottlePoolPath(key),
  )}?alt=media${cacheBust}`
}
