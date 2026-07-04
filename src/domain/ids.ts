/** Stable unique id. crypto.randomUUID is available in all modern browsers + jsdom. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // extremely defensive fallback (should never run in supported environments)
  return 'id-' + Math.abs(hashString(String(performance.now()))).toString(36)
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}
