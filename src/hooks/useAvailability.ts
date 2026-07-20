import { useCallback, useMemo } from 'react'
import type { Recipe } from '../db/schema'
import { canMake, makeableIds } from '../domain/availability'
import type { Availability } from '../components/RecipeRow'
import { useActiveBar, useCocktails, useComponents, usePantry } from './useRecipes'
import { useAssumeStaples } from './useSettings'

/**
 * Live "what can I make" state for the active bar, shared by Home/Browse/Search.
 * `badgeFor` returns null when the bar is empty so lists don't show noise.
 */
export function useAvailability() {
  const cocktails = useCocktails()
  const components = useComponents()
  const { barId, bars, setBarId } = useActiveBar()
  const { have } = usePantry(barId)
  const [assumeStaples] = useAssumeStaples()

  const byId = useMemo(
    () => new Map([...(cocktails ?? []), ...(components ?? [])].map((r) => [r.id, r])),
    [cocktails, components],
  )

  const makeable = useMemo(
    () => (cocktails ? makeableIds(cocktails, byId, have, assumeStaples) : new Set<string>()),
    [cocktails, byId, have, assumeStaples],
  )

  const badgeFor = useCallback(
    (r: Recipe): Availability => {
      if (have.size === 0) return null
      return canMake(r, have, byId, assumeStaples) ? 'ready' : 'missing'
    },
    [have, byId, assumeStaples],
  )

  return {
    have,
    byId,
    makeable,
    makeableCount: makeable.size,
    badgeFor,
    barId,
    bars,
    setBarId,
    assumeStaples,
  }
}
