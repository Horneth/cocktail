import { useCallback, useState, useSyncExternalStore } from 'react'
import type { VolumePreference } from '../domain/units'
import { DEFAULT_GEMINI_MODEL } from '../import/gemini'

const KEY = 'cocktail.volumePref'
const GEMINI_KEY = 'cocktail.geminiKey'
const GEMINI_MODEL = 'cocktail.geminiModel'
const ASSUME_STAPLES = 'cocktail.assumeStaples'
const ACTIVE_BAR = 'cocktail.activeBarId'

// A localStorage-backed value shared by EVERY hook instance (and browser tab).
// The naive `useState(() => localStorage.getItem(...))` pattern keeps a separate
// copy per component that only reads storage once at mount: switching the active
// bar on the Bar screen wrote localStorage but Home/Browse/Detail kept their
// stale copies, so the app flapped between values and could leave you "stuck" on
// a bar you'd already switched away from. useSyncExternalStore subscribes all of
// them to a single source of truth instead — an in-tab pub/sub for same-tab
// instances, plus the `storage` event for other tabs. No inventory is ever lost;
// the bottles just live under a different barId until the active id resyncs.
const listeners = new Set<() => void>()
let storageBound = false

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  if (!storageBound && typeof window !== 'undefined') {
    // Cross-tab: another tab writing localStorage fires 'storage' here (never in
    // the writing tab, which is why in-tab writes also call notify() directly).
    window.addEventListener('storage', notify)
    storageBound = true
  }
  return () => {
    listeners.delete(fn)
  }
}

function notify(): void {
  for (const fn of listeners) fn()
}

/** Write a localStorage key (null = remove) and wake every subscriber in this tab. */
function writeLocal(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  notify()
}

/** Global oz/ml display preference, persisted to localStorage. */
export function useVolumePreference(): [VolumePreference, () => void] {
  const pref = useSyncExternalStore(
    subscribe,
    () => (localStorage.getItem(KEY) === 'ml' ? 'ml' : 'oz'),
  )
  const toggle = useCallback(() => {
    writeLocal(KEY, localStorage.getItem(KEY) === 'ml' ? 'oz' : 'ml')
  }, [])
  return [pref, toggle]
}

/**
 * "Assume I have common basics" for the makeable filter (water, ice, citrus,
 * sugar, sodas, garnishes…). On by default so the bar only needs your bottles.
 */
export function useAssumeStaples(): [boolean, (v: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => localStorage.getItem(ASSUME_STAPLES) !== '0')
  const set = useCallback((v: boolean) => writeLocal(ASSUME_STAPLES, v ? '1' : '0'), [])
  return [on, set]
}

/**
 * The id of the currently-active bar. Global (not per-device-synced) and stored
 * in localStorage. Returns undefined until the user has selected one; the
 * `useActiveBar` hook resolves that to a real bar (falling back to the first).
 */
export function useActiveBarId(): [string | undefined, (id: string) => void] {
  const id = useSyncExternalStore(subscribe, () => localStorage.getItem(ACTIVE_BAR) ?? undefined)
  const set = useCallback((v: string) => writeLocal(ACTIVE_BAR, v), [])
  return [id, set]
}

export interface GeminiSettings {
  apiKey: string
  model: string
  hasKey: boolean
  setApiKey: (k: string) => void
  setModel: (m: string) => void
  clear: () => void
}

/**
 * The user's Gemini API key + model, stored ONLY in this browser's
 * localStorage. Never committed, never sent anywhere except Google's API.
 */
export function useGeminiSettings(): GeminiSettings {
  const [apiKey, setKey] = useState<string>(() => localStorage.getItem(GEMINI_KEY) ?? '')
  const [model, setModelState] = useState<string>(
    () => localStorage.getItem(GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL,
  )

  const setApiKey = useCallback((k: string) => {
    setKey(k)
    if (k.trim()) localStorage.setItem(GEMINI_KEY, k.trim())
    else localStorage.removeItem(GEMINI_KEY)
  }, [])

  const setModel = useCallback((m: string) => {
    const v = m.trim() || DEFAULT_GEMINI_MODEL
    setModelState(v)
    localStorage.setItem(GEMINI_MODEL, v)
  }, [])

  const clear = useCallback(() => {
    setKey('')
    localStorage.removeItem(GEMINI_KEY)
  }, [])

  return { apiKey, model, hasKey: apiKey.trim() !== '', setApiKey, setModel, clear }
}
