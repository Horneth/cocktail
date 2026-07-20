import { useCallback, useEffect, useState } from 'react'
import type { VolumePreference } from '../domain/units'

const KEY = 'cocktail.volumePref'
const ASSUME_STAPLES = 'cocktail.assumeStaples'
const ACTIVE_BAR = 'cocktail.activeBarId'

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

/**
 * The id of the currently-active bar. Global (not per-device-synced) and stored
 * in localStorage. Returns undefined until the user has selected one; the
 * `useActiveBar` hook resolves that to a real bar (falling back to the first).
 */
export function useActiveBarId(): [string | undefined, (id: string) => void] {
  const [id, setId] = useState<string | undefined>(
    () => localStorage.getItem(ACTIVE_BAR) ?? undefined,
  )
  const set = useCallback((v: string) => {
    setId(v)
    localStorage.setItem(ACTIVE_BAR, v)
  }, [])
  return [id, set]
}
