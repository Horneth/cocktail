import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RecipeRow } from '../components/RecipeRow'
import { BottomSheet } from '../components/BottomSheet'
import { SearchLauncher } from '../components/SearchLauncher'
import { CheckIcon, SearchIcon } from '../components/icons'
import type { Recipe } from '../db/schema'
import { makeableIds } from '../domain/availability'
import { recipesUsingBottle } from '../domain/barInsights'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { spiritSortIndex, tileKeyForRecipe } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { tagEmoji } from '../domain/vocab'
import { useCocktails, useComponents } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import styles from './BrowseScreen.module.css'

export function BrowseScreen() {
  const cocktails = useCocktails()
  const components = useComponents()
  const { badgeFor, byId, have, assumeStaples } = useAvailability()
  const [params, setParams] = useSearchParams()
  const [tagSheet, setTagSheet] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  const scope = params.get('scope') || 'all'
  const selectedTags = (params.get('tags') || '').split(',').filter(Boolean)
  const makeableOnly = params.get('makeable') === '1'
  // "Everything I could pour this bottle into" — where My Bar sends you. Matched
  // by the availability rules, so a rye lands on the Old Fashioned too.
  const ingredient = params.get('ingredient') || ''
  // The bottle's stored family travels with it, so the full list matches what
  // the bottle sheet showed even when the user corrected a wrong guess.
  const ingredientFamily = params.get('family') || undefined
  const isComponents = scope === 'components'

  const base = useMemo<Recipe[]>(() => {
    const all = isComponents ? (components ?? []) : (cocktails ?? [])
    const scoped = isComponents
      ? all
      : scope === 'all'
        ? all
        : scope === 'favorites'
          ? all.filter((c) => c.favorite)
          : all.filter((c) => tileKeyForRecipe(c) === scope)
    return ingredient ? recipesUsingBottle(ingredient, scoped, byId, ingredientFamily) : scoped
  }, [cocktails, components, scope, isComponents, ingredient, ingredientFamily, byId])

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    base.forEach((r) => r.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [base])

  const makeable = useMemo(
    () => (makeableOnly ? makeableIds(base, byId, have, assumeStaples) : null),
    [makeableOnly, base, byId, have, assumeStaples],
  )

  const list = useMemo(
    () =>
      base.filter(
        (r) =>
          selectedTags.every((t) => r.tags.includes(t)) && (!makeable || makeable.has(r.id)),
      ),
    [base, selectedTags, makeable],
  )

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
    if ((components ?? []).length) out.push({ key: 'components', label: 'Syrups', emoji: '🍯' })
    return out
  }, [cocktails, components])

  const patch = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }
  const clearIngredient = () => {
    const p = new URLSearchParams(params)
    p.delete('ingredient')
    p.delete('family')
    setParams(p, { replace: true })
  }
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

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.count}>{list.length} recipes</div>
        <h1 className={styles.title}>Browse</h1>
      </div>

      <SearchLauncher />

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

      <div className={styles.tagHead}>
        <span className={styles.tagHeadLabel}>Filter by tag</span>
        {selectedTags.length > 0 && (
          <button className={styles.clearTags} onClick={() => setTags([])}>
            Clear {selectedTags.length}
          </button>
        )}
      </div>

      <div className={`${styles.tagRow} hg-scroll`}>
        {have.size > 0 && (
          <button
            className={`${styles.ready} ${makeableOnly ? styles.readyOn : ''}`}
            onClick={() => patch('makeable', makeableOnly ? null : '1')}
          >
            <CheckIcon size={14} /> Ready to pour
          </button>
        )}
        <button className={styles.allTags} onClick={() => setTagSheet(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          All tags
        </button>
        {tagCounts.slice(0, 10).map(([t]) => tagChip(t, selectedTags.includes(t)))}
      </div>

      {list.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyEmoji}>🍸</div>
          <p className={styles.emptyText}>No drinks match those filters</p>
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
          <button className={styles.sheetClear} onClick={() => setTags([])}>
            Clear all
          </button>
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
