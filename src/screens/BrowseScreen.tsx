import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BottleIcon, ChevronLeftIcon, SearchIcon } from '../components/icons'
import { RecipeCard } from '../components/RecipeCard'
import type { Recipe } from '../db/schema'
import { makeableIds } from '../domain/availability'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { tileKeyForRecipe, tileMeta } from '../domain/spirits'
import { useCocktails, useComponents, usePantry } from '../hooks/useRecipes'
import { useAssumeStaples } from '../hooks/useSettings'
import styles from './BrowseScreen.module.css'

const TAG_LIMIT = 16
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function BrowseScreen() {
  const navigate = useNavigate()
  const cocktails = useCocktails()
  const components = useComponents()
  const { have } = usePantry()
  const [assumeStaples] = useAssumeStaples()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)

  const scope = params.get('scope') || 'all'
  const selectedTags = (params.get('tags') || '').split(',').filter(Boolean)
  const makeableOnly = params.get('makeable') === '1'
  const isComponents = scope === 'components'

  // base set for the current scope (spirit / all / favorites / components)
  const base = useMemo<Recipe[]>(() => {
    if (isComponents) return components ?? []
    const list = cocktails ?? []
    if (scope === 'all') return list
    if (scope === 'favorites') return list.filter((c) => c.favorite)
    return list.filter((c) => tileKeyForRecipe(c) === scope)
  }, [cocktails, components, scope, isComponents])

  // tags available within the scope, most-used first
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    base.forEach((r) => r.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [base])

  // recipes makeable from the current bar (needs all recipes for sub-recipe resolution)
  const makeable = useMemo(() => {
    if (!makeableOnly) return null
    const all = [...(cocktails ?? []), ...(components ?? [])]
    const byId = new Map(all.map((r) => [r.id, r]))
    return makeableIds(base, byId, have, assumeStaples)
  }, [makeableOnly, base, cocktails, components, have, assumeStaples])

  // AND semantics: a recipe must have every selected tag
  const list = useMemo(
    () =>
      base.filter(
        (r) =>
          matchesQuery(r, query) &&
          selectedTags.every((t) => r.tags.includes(t)) &&
          (!makeable || makeable.has(r.id)),
      ),
    [base, query, selectedTags, makeable],
  )

  const patchParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }

  const setTags = (next: string[]) => {
    const p = new URLSearchParams(params)
    if (next.length) p.set('tags', next.join(','))
    else p.delete('tags')
    setParams(p, { replace: true })
  }
  const toggleTag = (t: string) =>
    setTags(selectedTags.includes(t) ? selectedTags.filter((x) => x !== t) : [...selectedTags, t])

  const scopeMeta = tileMeta(scope)
  const tagDriven = scope === 'all' && selectedTags.length > 0
  const title = tagDriven ? selectedTags.map(cap).join(' + ') : scopeMeta.label
  const emoji = tagDriven ? '🏷️' : scopeMeta.emoji

  const visibleTags = showAllTags ? tagCounts : tagCounts.slice(0, TAG_LIMIT)
  const mixed = scope === 'all' || scope === 'favorites'

  return (
    <div className={styles.screen}>
      <header className={styles.header} style={{ background: scopeMeta.gradient }}>
        <div className={styles.topRow}>
          <button className={styles.back} aria-label="Back" onClick={() => navigate('/')}>
            <ChevronLeftIcon size={26} />
          </button>
          <span className={styles.emoji}>{emoji}</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.search}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ingredient…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button className={styles.clear} onClick={() => setQuery('')} aria-label="Clear">
              ×
            </button>
          )}
        </div>
      </header>

      <div className={styles.makeableRow}>
        <label className={styles.makeableToggle}>
          <BottleIcon size={17} className={styles.makeableIcon} />
          <span>Only what I can make</span>
          <input
            type="checkbox"
            className={styles.switch}
            checked={makeableOnly}
            onChange={(e) => patchParam('makeable', e.target.checked ? '1' : null)}
          />
        </label>
      </div>

      {makeableOnly && have.size === 0 && (
        <p className={styles.makeableHint}>
          Your bar is empty. <Link to="/bar">Add your bottles</Link> to see what you can make.
        </p>
      )}

      {!isComponents && tagCounts.length > 0 && (
        <section className={styles.tagPicker}>
          <div className={styles.tagHead}>
            <span className={styles.tagTitle}>
              Tags{selectedTags.length > 0 ? ` · ${selectedTags.length}` : ''}
            </span>
            {selectedTags.length > 0 && (
              <button className={styles.clearTags} onClick={() => setTags([])}>
                Clear
              </button>
            )}
          </div>
          <div className={styles.tagChips}>
            {visibleTags.map(([t, n]) => {
              const on = selectedTags.includes(t)
              return (
                <button
                  key={t}
                  className={`${styles.tagChip} ${on ? styles.tagChipOn : ''}`}
                  onClick={() => toggleTag(t)}
                >
                  #{t}
                  <span className={styles.tagCount}>{n}</span>
                </button>
              )
            })}
            {tagCounts.length > TAG_LIMIT && (
              <button className={styles.moreTags} onClick={() => setShowAllTags((v) => !v)}>
                {showAllTags ? 'Show less' : `+${tagCounts.length - TAG_LIMIT} more`}
              </button>
            )}
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <p className={styles.empty}>
          {query || selectedTags.length ? 'No matches with these filters.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {list.map((r) => (
            <li key={r.id}>
              <RecipeCard
                recipe={r}
                showHeart={!isComponents}
                showSpirit={mixed}
                onDelete={() => void deleteRecipeWithConfirm(r)}
              />
            </li>
          ))}
        </ul>
      )}

      <Link className={styles.fab} to="/new" aria-label="New recipe">
        <span>＋</span>
      </Link>
    </div>
  )
}
