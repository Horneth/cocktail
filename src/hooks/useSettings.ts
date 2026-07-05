import { useCallback, useEffect, useState } from 'react'
import type { VolumePreference } from '../domain/units'
import { DEFAULT_GEMINI_MODEL } from '../import/gemini'

const KEY = 'cocktail.volumePref'
const GEMINI_KEY = 'cocktail.geminiKey'
const GEMINI_MODEL = 'cocktail.geminiModel'
const ASSUME_STAPLES = 'cocktail.assumeStaples'

function read(): VolumePreference {
  const v = localStorage.getItem(KEY)
  return v === 'ml' ? 'ml' : 'oz'
}

/** Global oz/ml display preference, persisted to localStorage. */
export function useVolumePreference(): [VolumePreference, () => void] {
  const [pref, setPref] = useState<VolumePreference>(read)

  useEffect(() => {
    localStorage.setItem(KEY, pref)
  }, [pref])

  const toggle = useCallback(() => {
    setPref((p) => (p === 'oz' ? 'ml' : 'oz'))
  }, [])

  return [pref, toggle]
}

/**
 * "Assume I have common basics" for the makeable filter (water, ice, citrus,
 * sugar, sodas, garnishes…). On by default so the bar only needs your bottles.
 */
export function useAssumeStaples(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => localStorage.getItem(ASSUME_STAPLES) !== '0')
  const set = useCallback((v: boolean) => {
    setOn(v)
    localStorage.setItem(ASSUME_STAPLES, v ? '1' : '0')
  }, [])
  return [on, set]
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
