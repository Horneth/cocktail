import { useCallback, useEffect, useState } from 'react'
import type { VolumePreference } from '../domain/units'

const KEY = 'cocktail.volumePref'

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
