// A tiny, dependency-free event log for diagnosing the optional Google sign-in
// on real devices, where there is no console to read.
//
// Entries go to the browser console *and* to a ring buffer that the Settings
// screen's Diagnostics panel renders on-screen. The buffer lives in
// sessionStorage on purpose: a redirect sign-in reloads the whole page (and
// leaves the origin for Google's), and sessionStorage is the one store that
// survives a same-tab round-trip. localStorage would outlive the tab and leak
// stale runs; memory would be wiped by the reload.

export interface DebugEntry {
  /** ISO timestamp. */
  t: string
  /** Subsystem, e.g. `auth`, `window`. */
  scope: string
  message: string
  /** Formatted error code/message or small JSON, when there is one. */
  detail?: string
}

const KEY = 'cocktail.debugLog'
const MAX = 300

const listeners = new Set<() => void>()
// Replaced (never mutated) on every log, so useSyncExternalStore sees a new
// snapshot exactly when something was added.
let entries: DebugEntry[] = load()

function load(): DebugEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as DebugEntry[]) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Private mode / quota. The in-memory copy still drives the on-screen panel.
  }
}

/**
 * `name (code): message` for an Error, else its string form. Firebase errors
 * carry a stable `auth/...` code that names the real failure, which is exactly
 * what we are hunting — so it leads.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    const head = typeof code === 'string' && code ? `${code} — ${err.name}` : err.name
    return `${head}: ${err.message}`
  }
  return String(err)
}

/** Turn arbitrary data into a single printable line. */
export function formatDetail(data: unknown): string | undefined {
  if (data === undefined) return undefined
  if (data === null) return 'null'
  if (typeof data === 'string') return data
  if (data instanceof Error) return describeError(data)
  try {
    const s = JSON.stringify(data)
    return s === '{}' ? String(data) : s
  } catch {
    return String(data)
  }
}

/** Record one event. Never throws. */
export function debugLog(scope: string, message: string, data?: unknown): void {
  const detail = formatDetail(data)
  entries = [...entries, { t: new Date().toISOString(), scope, message, detail }].slice(-MAX)
  persist()
  console.log(`[cocktails:${scope}] ${message}${detail ? ` — ${detail}` : ''}`)
  listeners.forEach((l) => l())
}

export function getDebugEntries(): DebugEntry[] {
  return entries
}

export function subscribeDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearDebugLog(): void {
  entries = []
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
  listeners.forEach((l) => l())
}

let capturing = false

/**
 * Log uncaught errors and unhandled rejections into the buffer (once). An
 * exception thrown out of a promise we never awaited would otherwise vanish on
 * a phone with no console — and those are the ones worth seeing.
 */
export function installDebugCapture(): void {
  if (capturing || typeof window === 'undefined') return
  capturing = true
  window.addEventListener('error', (e) =>
    debugLog('window', 'uncaught error', e.error ?? e.message),
  )
  window.addEventListener('unhandledrejection', (e) =>
    debugLog('window', 'unhandled rejection', e.reason),
  )
}
