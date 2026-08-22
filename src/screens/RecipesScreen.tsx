import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RecipeRow } from '../components/RecipeRow'
import { BottomSheet } from '../components/BottomSheet'
import { CheckIcon, ChevronRightIcon, GearIcon, SearchIcon } from '../components/icons'
import type { Recipe } from '../db/schema'
import { makeableIds } from '../domain/availability'
import { recipesUsingBottle } from '../domain/barInsights'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { spiritSortIndex, tileKeyForRecipe } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { tagEmoji } from '../domain/vocab'
import { useCocktails, useMixers } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import styles from './RecipesScreen.module.css'

/**
 * The app's one recipes surface and its one search box. Home, Search and the
 * old Browse tab were three ways into the same list of drinks; this screen is
 * that list, with an always-on search field and chips that filter what's
 * already on screen. Finding a drink is the whole job of the primary tab.
 */
export function RecipesScreen() {
  const cocktails = useCocktails()
  const mixers = useMixers()
  const { makeableCount, badgeFor, byId, have, assumeStaples, barId, bars } =
    useAvailability()
  const [params, setParams] = useSearchParams()
  const [tagSheet, setTagSheet] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  const q = (params.get('q') ?? '').trim()
  const scope = params.get('scope') || 'all'
  const selectedTags = (params.get('tags') || '').split(',').filter(Boolean)
  const makeableOnly = params.get('makeable') === '1'
  // "Everything I could pour this bottle into" — where My Bar sends you. Matched
  // by the availability rules, so a rye lands on the Old Fashioned too.
  const ingredient = params.get('ingredient') || ''
  // The bottle's stored family travels with it, so the full list matches what
  // the bottle sheet showed even when the user corrected a wrong guess.
  const ingredientFamily = params.get('family') || undefined
  const isMixers = scope === 'mixers'

  const barName = bars.find((b) => b.id === barId)?.name ?? 'Your bar'

  const scoped = useMemo<Recipe[]>(() => {
    const all = isMixers ? (mixers ?? []) : (cocktails ?? [])
    return isMixers
      ? all
      : scope === 'all'
        ? all
        : scope === 'favorites'
          ? all.filter((c) => c.favorite)
          : all.filter((c) => tileKeyForRecipe(c) === scope)
  }, [cocktails, mixers, scope, isMixers])

  const base = useMemo(
    () => (ingredient ? recipesUsingBottle(ingredient, scoped, byId, ingredientFamily) : scoped),
    [scoped, ingredient, ingredientFamily, byId],
  )

  // Search and filter are two different jobs, but both shrink the same list, so
  // they compose here rather than as separate screens.
  const searched = useMemo(
    () => (q ? base.filter((r) => matchesQuery(r, q)) : base),
    [base, q],
  )

  const makeable = useMemo(
    () => (makeableOnly ? makeableIds(searched, byId, have, assumeStaples) : null),
    [makeableOnly, searched, byId, have, assumeStaples],
  )

  const list = useMemo(
    () =>
      searched.filter(
        (r) =>
          selectedTags.every((t) => r.tags.includes(t)) && (!makeable || makeable.has(r.id)),
      ),
    [searched, selectedTags, makeable],
  )

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    base.forEach((r) => r.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [base])

  // Spirit filter chips: All + Favorites/Syrups when present + each spirit used.
  const chips = useMemo(() => {
    const out: { key: string; label: string; emoji: string }[] = [
      { key: 'all', label: 'All', emoji: '✨' },
    ]
    const list = cocktails ?? []
    if (list.some((c) => c.favorite)) out.push({ key: 'favorites', label: 'Favorites', emoji: '❤️' })
    const spiritKeys = new Set(list.map((c) => tileKeyForRecipe(c)))
    ;[...spiritKeys]
      .sort((a, b) => spiritSortIndex(a) - spiritSortIndex(b) || a.localeCompare(b))
      .forEach((k) => {
        const v = spiritVisual(k)
        out.push({ key: k, label: v.label, emoji: v.emoji })
      })
    if ((mixers ?? []).length) out.push({ key: 'mixers', label: 'Syrups & cordials', emoji: '🍯' })
    return out
  }, [cocktails, mixers])

  const patch = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, {
      replace: true,
      // Keep the search field's focus after a chip tap.
      state: { retainFocus: true },
    })
  }
  const clearIngredient = () => patch('ingredient', null)
  const setQ = (value: string) => patch('q', value || null)
  const setTags = (next: string[]) => patch('tags', next.length ? next.join(',') : null)
  const toggleTag = (t: string) =>
    setTags(selectedTags.includes(t) ? selectedTags.filter((x) => x !== t) : [...selectedTags, t])
  const selectScope = (key: string) => patch('scope', key === 'all' ? null : key)

  const filteredSheetTags = tagQuery.trim()
    ? tagCounts.filter(([t]) => t.includes(tagQuery.trim().toLowerCase()))
    : tagCounts

  const tagChip = (t: string, on: boolean) => (
    <button
      key={t}
      className={`${styles.tag} ${on ? styles.tagOn : ''}`}
      onClick={() => toggleTag(t)}
    >
      <span className={styles.tagEmoji}>{tagEmoji(t)}</span>
      {t}
    </button>
  )

  const searching = q !== ''
  const filtering = searching || scope !== 'all' || selectedTags.length > 0 || makeableOnly

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Cocktails</h1>
          <Link className={styles.ready} to={makeableCount > 0 ? '/?makeable=1' : '/bar'}>
            <span className={styles.readyText}>
              {makeableCount > 0 ? (
                <b>{makeableCount}</b>
              ) : (
                'Nothing ready yet'
              )}{' '}
              {makeableCount > 0 && `of ${cocktails?.length ?? 0}`} · at {barName}
            </span>
            <ChevronRightIcon size={15} className={styles.readyChevron} />
          </Link>
        </div>
        <Link className={styles.gear} to="/settings" aria-label="Settings">
          <GearIcon size={19} />
        </Link>
      </header>

      <div className={styles.searchBar}>
        <SearchIcon size={19} className={styles.searchIcon} />
        <input
          className={styles.input}
          value={params.get('q') ?? ''}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search drinks, spirits, ingredients"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button className={styles.clear} onClick={() => setQ('')} aria-label="Clear search">
            ✕
          </button>
        )}
      </div>

      {ingredient && (
        <button className={styles.ingredientPill} onClick={clearIngredient}>
          Pouring {ingredient}
          <span className={styles.ingredientClear} aria-hidden>
            ✕
          </span>
        </button>
      )}

      <div className={`${styles.spiritRow} hg-scroll`}>
        {chips.map((c) => (
          <button
            key={c.key}
            className={`${styles.spiritChip} ${scope === c.key ? styles.spiritChipOn : ''}`}
            onClick={() => selectScope(c.key)}
          >
            <span className={styles.spiritEmoji}>{c.emoji}</span>
            {c.label}
          </button>
        ))}
      </div>

      <div className={styles.tagRow}>
        {have.size > 0 && (
          <>
            <button
              className={`${styles.readyChip} ${makeableOnly ? styles.readyChipOn : ''}`}
              onClick={() => patch('makeable', makeableOnly ? null : '1')}
            >
              {makeableOnly && <CheckIcon size={14} />} Ready to pour
            </button>
            <button className={styles.allTags} onClick={() => setTagSheet(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5h18M6 12h12M10 19h4" />
              </svg>
              Tags
            </button>
          </>
        )}
        {!filtering && tagCounts.slice(0, 6).map(([t]) => tagChip(t, false))}
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyEmoji}>🍸</div>
          <p className={styles.emptyText}>
            {searching ? `Nothing for “${q}”` : 'No drinks match those filters'}
          </p>
          {!searching && !filtering && cocktails?.length === 0 && (
            <>
              <p className={styles.emptyHint}>Tap ＋ below to add your first cocktail.</p>
              <Link className={styles.emptyLink} to="/new">
                Build one
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {list.map((r) => (
            <RecipeRow
              key={r.id}
              recipe={r}
              badge={badgeFor(r)}
              onDelete={() => void deleteRecipeWithConfirm(r)}
            />
          ))}
        </div>
      )}

      <BottomSheet open={tagSheet} onClose={() => setTagSheet(false)}>
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle}>All tags</h2>
          {selectedTags.length > 0 && (
            <button className={styles.sheetClear} onClick={() => setTags([])}>
              Clear all
            </button>
          )}
        </div>
        <div className={styles.sheetSearch}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.sheetInput}
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="Search tags"
          />
        </div>
        <div className={`${styles.sheetTags} hg-scroll`}>
          {filteredSheetTags.length === 0 ? (
            <p className={styles.noTags}>No tags yet.</p>
          ) : (
            filteredSheetTags.map(([t]) => tagChip(t, selectedTags.includes(t)))
          )}
        </div>
      </BottomSheet>
    </div>
  )
}