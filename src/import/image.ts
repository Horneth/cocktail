// Browser image helpers for the "scan my shelf" flow. Lives in import/ (not
// domain/) because it touches the DOM (canvas/createImageBitmap). Only
// `splitDataUrl` is pure — it's unit-tested; the canvas path is exercised in the
// browser.

import { MAX_IMAGE_BYTES } from './limits'

/** Parse a `data:<mime>;base64,<data>` URL into its parts, or null if malformed. */
export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  return m ? { mimeType: m[1], data: m[2] } : null
}

/** Decoded size of a base64 data URL, computed from its length rather than decoded. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const b64 = dataUrl.slice(comma + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

// A 1024px q0.7 JPEG is normally well inside the budget, but a busy, detailed
// shelf photo is exactly the kind that isn't — and the payload is the thing we
// pay for. Step the quality down until it fits rather than rejecting the photo.
const QUALITY_STEPS = [0.7, 0.55, 0.4]

/**
 * Read an image File and return a downscaled JPEG data URL. Shrinking the
 * longest edge to `maxEdge` keeps the Gemini payload small enough to stay under
 * the request timeout when several photos are sent at once, and under `maxBytes`
 * so one photo can't cost an unbounded number of tokens.
 */
export async function downscaleDataUrl(
  file: File,
  maxEdge = 1024,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const cx = canvas.getContext('2d')
  if (!cx) throw new Error('Canvas is not supported on this device.')
  cx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  let out = canvas.toDataURL('image/jpeg', QUALITY_STEPS[0])
  for (let i = 1; i < QUALITY_STEPS.length && dataUrlBytes(out) > maxBytes; i += 1) {
    out = canvas.toDataURL('image/jpeg', QUALITY_STEPS[i])
  }
  return out
}
