// Bridge for the Android Web Share Target. When the OS shares a YouTube video
// (or selected description text) into the installed PWA, the browser navigates
// to the app's start URL with the shared fields as query params (see the
// `share_target` manifest entry). `stashSharedImport` runs once at boot in
// main.tsx, captures those params, and hands them to the Import screen via
// sessionStorage so hash-routing and React can take over cleanly.

const KEY = 'cocktail.sharedImport'

/** Read share-target GET params from the current URL, if any, and combine them
 *  into a single block of text for the importer. Returns null when absent. */
export function readShareParams(search: string): string | null {
  const params = new URLSearchParams(search)
  const title = params.get('title')?.trim()
  const shared = params.get('text')?.trim()
  const url = params.get('url')?.trim()
  if (!title && !shared && !url) return null

  // De-dupe: YouTube often puts the same link in both `text` and `url`.
  const parts = [title, shared, url].filter((p): p is string => !!p)
  const seen = new Set<string>()
  const text = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join('\n')
  return text || null
}

/** Called once at startup: if the URL carries shared content, stash it for the
 *  Import screen and return true (so the caller can redirect to #/import). */
export function stashSharedImport(search: string): boolean {
  const text = readShareParams(search)
  if (!text) return false
  try {
    sessionStorage.setItem(KEY, text)
  } catch {
    return false
  }
  return true
}

/** Peek whether shared text is waiting, without clearing it. */
export function hasSharedImport(): boolean {
  try {
    return !!sessionStorage.getItem(KEY)
  } catch {
    return false
  }
}

/** Import screen pulls (and clears) any pending shared text. */
export function consumeSharedImport(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    if (v) sessionStorage.removeItem(KEY)
    return v
  } catch {
    return null
  }
}
