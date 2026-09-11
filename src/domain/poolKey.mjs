// Shared rules for the generated-image pool — the one file the app, the seeder
// script and the Cloud Function all import, so the key a recipe stores can
// never drift from the file that was written.
//
// A pool entry is content-addressed by drink name: every user who adds
// "Paper Plane" shares one entry, generated once. Plain ESM (no TS, no deps)
// on purpose — it must run everywhere untransformed, which is why this file
// is .mjs with JSDoc rather than the TypeScript beside it.
//
// Security posture (keep it true):
//  - The pool KEY derives only from the normalized name. It is a lookup, not
//    input to any prompt, so a crafted name can steer a request at most onto
//    another drink's existing image — it can never create a new one.
//  - `sanitizeDrinkName` is what the generator side embeds into the prompt.
//    Names are DATA, never instructions: control characters and prompt /
//    markdown structure are stripped and length is capped.

/** Storage layout: generated/v1/<key>-<size>.webp */
export const POOL_V = 'v1'

export const POOL_SIZES = {
  thumb: { w: 256, h: 256, crop: true },
  card: { w: 512, h: 512, crop: true },
  // full keeps the generator's 3:4 frame uncropped for the detail hero.
  full: { w: 896, h: 1200, crop: false },
}

/** Hard cap on how much of a drink name the generator may ever see. */
export const MAX_NAME = 80

/**
 * Content-addressed pool key for a drink name: case-, punctuation- and
 * diacritic-insensitive, stable, filesystem-safe. '' when nothing usable
 * survives normalization (callers fall back to the spirit tile).
 */
export function slugifyPoolKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

/** Convenience: the key, or '' when the name is unusable. */
export function poolKeyForName(name) {
  return slugifyPoolKey(name)
}

/**
 * Make a drink name inert for embedding in a generation prompt: no control
 * characters, no markdown/prompt structure, collapsed whitespace, capped
 * length. Every generator (seeder script, Cloud Function) MUST pass the name
 * through this before it touches a prompt.
 */
export function sanitizeDrinkName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`*_~#[\]{}<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim()
}

/** Object path (without bucket) of one pool file. */
export function poolPath(key, size) {
  return `generated/${POOL_V}/${key}-${size}.webp`
}
