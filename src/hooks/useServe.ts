import { useCallback, useMemo } from 'react'
import { makeableIds } from '../domain/availability'
import { createBar } from '../domain/bars'
import { addToPantry } from '../domain/pantry'
import { useActiveBar, useCocktails, useMixers, usePantry } from './useRecipes'
import { useAssumeStaples, useServeMenuIds } from './useSettings'

// State for the "Pour a round" screen. Pour is a view over the ACTIVE bar —
// at home that's My Bar and it's instantly meaningful; at a borrowed place the
// bar line's "Pour elsewhere" creates a fresh session bar to pour from. The
// bottle sheet and shopping-list pills both edit that bar's shelf, so the shelf
// stays the single source of truth: nothing bookkeeping-shaped can drift from
// what the drinks' badges say.
//
// The menu (curated drinks) is deliberately bar-independent — it's this
// gathering's list, and its badges recompute against whichever bar is active.

export function useServe() {
  const cocktails = useCocktails()
  const mixers = useMixers()
  const { barId, bars, setBarId } = useActiveBar()
  const [globalStaples] = useAssumeStaples()
  const [menuIds, toggleMenuId, clearMenu] = useServeMenuIds()

  const { items, have } = usePantry(barId)
  const assumeStaples = globalStaples

  const byId = useMemo(
    () => new Map([...(cocktails ?? []), ...(mixers ?? [])].map((r) => [r.id, r])),
    [cocktails, mixers],
  )
  const makeable = useMemo(
    () => (cocktails ? makeableIds(cocktails, byId, have, assumeStaples) : new Set<string>()),
    [cocktails, byId, have, assumeStaples],
  )

  // The menu as recipes, in add order — dropping ids whose recipe is gone.
  const menu = useMemo(() => {
    const byIdRef = byId
    return menuIds
      .map((id) => byIdRef.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r && r.kind === 'cocktail')
  }, [menuIds, byId])

  const barName = bars.find((b) => b.id === barId)?.name

  // A shopping-list pill is a real bottle: "we found the Campari" writes it
  // into the bar, the same write the bottle sheet would make.
  const addToBar = useCallback(
    async (label: string, category?: string) => {
      if (!barId) return
      await addToPantry(barId, { label, category })
    },
    [barId],
  )

  // The borrowed-kitchen case: a fresh bar to pour from, named later.
  const pourElsewhere = useCallback(async () => {
    setBarId(await createBar('Session'))
  }, [setBarId])

  const toggleMenu = useCallback(
    (id: string, on: boolean) => toggleMenuId(id, on),
    [toggleMenuId],
  )

  return {
    /** the active bar — the context every badge, chip and pill writes into */
    barId,
    barName: barName ?? 'My Bar',
    /** bottle count for the header line (`items` is the active bar's shelf) */
    barCount: items.length,
    bars,
    setBarId,
    items,
    have,
    cocktails: cocktails ?? [],
    byId,
    makeable,
    /** the curated menu, as recipes in add order */
    menu,
    toggleMenu,
    clearMenu,
    assumeStaples,
    addToBar,
    pourElsewhere,
    loaded: bars !== undefined,
  }
}

export type Serve = ReturnType<typeof useServe>