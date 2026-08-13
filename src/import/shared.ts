// Bridge for the Android Web Share Target. When the OS shares a YouTube video
// (or selected description text) into the installed PWA, the browser navigates
// to the app's start URL with the shared fields as query params (see the
// `share_target` manifest entry). `stashSharedImport` runs once at boot in
// main.tsx, captures those params, and hands them to the Import screen via
// sessionStorage so hash-routing and React can take over cleanly.

const KEY = 'cocktail.sharedImport'

export interface SharedImport {
  text: string
  /**
   * Whether the Import screen may send this straight to the parser without the
   * user pressing anything.
   *
   * Any app on the phone can share into us, so an unattended extract means
   * arbitrary text reaching the model — and spending quota — on someone else's
   * say-so. Only the case this share target was built for gets that: a link to
   * a video, short enough to be a description rather than a document. Everything
   * else lands in the textarea and waits for the Extract button.
   */
  auto: boolean
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
])

/** Longest share we'll extract unattended. A description tops out around 5k. */
const MAX_AUTO_CHARS = 8_000

function isYouTubeLink(url: string | undefined): boolean {
  if (!url) return false
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Read share-target GET params from the current URL, if any, and combine them
 *  into a single block of text for the importer. Returns null when absent. */
export function readShareParams(search: string): SharedImport | null {
  const params = new URLSearchParams(search)
  const title = params.get('title')?.trim()
  const shared = params.get('text')?.trim()
  const url = params.get('url')?.trim()
  if (!title && !shared && !url) return null

  // De-dupe: YouTube often puts the same link in both `text` and `url`.
  const parts = [title, shared, url].filter((p): p is string => !!p)
  const seen = new Set<string>()
  const text = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join('\n')
  if (!text) return null

  // `text` can carry the link too when the sharing app doesn't fill `url`.
  const link = isYouTubeLink(url) || (!url && isYouTubeLink(shared))
  return { text, auto: link && text.length <= MAX_AUTO_CHARS }
}

/** Called once at startup: if the URL carries shared content, stash it for the
 *  Import screen and return true (so the caller can redirect to #/import). */
export function stashSharedImport(search: string): boolean {
  const shared = readShareParams(search)
  if (!shared) return false
  try {
    sessionStorage.setItem(KEY, JSON.stringify(shared))
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
export function consumeSharedImport(): SharedImport | null {
  let v: string | null
  try {
    v = sessionStorage.getItem(KEY)
    if (v) sessionStorage.removeItem(KEY)
  } catch {
    return null
  }
  if (!v) return null
  try {
    const parsed = JSON.parse(v) as Partial<SharedImport>
    if (typeof parsed?.text !== 'string' || !parsed.text) return null
    return { text: parsed.text, auto: parsed.auto === true }
  } catch {
    // A bare string stashed by a build from before this envelope existed.
    // Keep it, but never auto-extract something we can't vouch for.
    return { text: v, auto: false }
  }
}
