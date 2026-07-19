// Browser image helpers for the "scan my shelf" flow. Lives in import/ (not
// domain/) because it touches the DOM (canvas/createImageBitmap). Only
// `splitDataUrl` is pure — it's unit-tested; the canvas path is exercised in the
// browser.

/** Parse a `data:<mime>;base64,<data>` URL into its parts, or null if malformed. */
export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  return m ? { mimeType: m[1], data: m[2] } : null
}

/**
 * Read an image File and return a downscaled JPEG data URL. Shrinking the
 * longest edge to `maxEdge` keeps the Gemini payload small enough to stay under
 * the request timeout when several photos are sent at once.
 */
export async function downscaleDataUrl(file: File, maxEdge = 1024): Promise<string> {
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
  return canvas.toDataURL('image/jpeg', 0.7)
}
