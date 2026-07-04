import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FlaskIcon,
  GearIcon,
  HeartIcon,
  ImportIcon,
  PlusIcon,
  SearchIcon,
} from '../components/icons'
import { SwipeableRow } from '../components/SwipeableRow'
import { FEATURES } from '../config'
import type { Recipe } from '../db/schema'
import { formatAmount } from '../domain/units'
import { countUsage, deleteRecipe, setFavorite } from '../import/importRecipe'
import { useCocktails, useComponents } from '../hooks/useRecipes'
import styles from './HomeScreen.module.css'

type Filter = 'cocktail' | 'component'

function matches(recipe: Recipe, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  if (recipe.name.toLowerCase().includes(needle)) return true
  if (recipe.spirit?.toLowerCase().includes(needle)) return true
  if (recipe.tags.some((t) => t.toLowerCase().includes(needle))) return true
  return recipe.ingredients.some((i) => i.name.toLowerCase().includes(needle))
}

export function HomeScreen() {
  const cocktails = useCocktails()
  const components = useComponents()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('cocktail')
  const [spirit, setSpirit] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [favOnly, setFavOnly] = useState(false)

  const source = filter === 'cocktail' ? cocktails : components
  const hasFavorites = useMemo(() => cocktails?.some((c) => c.favorite) ?? false, [cocktails])

  const spirits = useMemo(() => {
    const set = new Set<string>()
    cocktails?.forEach((c) => c.spirit && c.spirit !== 'none' && set.add(c.spirit))
    return [...set].sort()
  }, [cocktails])

  const tags = useMemo(() => {
    const count = new Map<string, number>()
    cocktails?.forEach((c) => c.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    // most-used first, then alphabetical
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [cocktails])

  const list = useMemo(() => {
    if (!source) return []
    const filtered = source.filter(
      (r) =>
        matches(r, query) &&
        (filter === 'component' || !spirit || r.spirit === spirit) &&
        (filter === 'component' || !tag || r.tags.includes(tag)) &&
        (filter === 'component' || !favOnly || r.favorite),
    )
    // pin favorites to the top (stable sort keeps the alphabetical order within groups)
    return filter === 'cocktail'
      ? filtered.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      : filtered
  }, [source, query, spirit, tag, favOnly, filter])

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <h1 className={styles.brand}>Cocktails</h1>
          <div className={styles.headerActions}>
            <Link className={styles.importBtn} to="/import">
              <ImportIcon size={17} />
              Import
            </Link>
            {FEATURES.cloudAI && (
              <Link className={styles.gearBtn} to="/settings" aria-label="Settings">
                <GearIcon size={20} />
              </Link>
            )}
          </div>
        </div>
        <div className={styles.search}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, spirit, ingredient…"
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

        <div className={styles.segment}>
          <button
            className={`${styles.segBtn} ${filter === 'cocktail' ? styles.segActive : ''}`}
            onClick={() => setFilter('cocktail')}
          >
            Cocktails
          </button>
          <button
            className={`${styles.segBtn} ${filter === 'component' ? styles.segActive : ''}`}
            onClick={() => setFilter('component')}
          >
            Syrups & more
          </button>
        </div>

        {filter === 'cocktail' && (spirits.length > 0 || hasFavorites) && (
          <div className={styles.chips}>
            {hasFavorites && (
              <button
                className={`${styles.chip} ${styles.favChip} ${favOnly ? styles.favChipActive : ''}`}
                onClick={() => setFavOnly((v) => !v)}
              >
                <HeartIcon size={13} filled={favOnly} /> Favorites
              </button>
            )}
            <button
              className={`${styles.chip} ${spirit === null ? styles.chipActive : ''}`}
              onClick={() => setSpirit(null)}
            >
              All
            </button>
            {spirits.map((s) => (
              <button
                key={s}
                className={`${styles.chip} ${spirit === s ? styles.chipActive : ''}`}
                onClick={() => setSpirit(spirit === s ? null : s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {filter === 'cocktail' && tags.length > 0 && (
          <div className={styles.chips}>
            {tags.map((t) => (
              <button
                key={t}
                className={`${styles.tagChip} ${tag === t ? styles.tagChipActive : ''}`}
                onClick={() => setTag(tag === t ? null : t)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </header>

      {source === undefined ? (
        <p className={styles.empty}>…</p>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          {query || spirit || tag || favOnly ? (
            <p>No matches{query ? ` for “${query}”` : ''}.</p>
          ) : filter === 'component' ? (
            <p>No sub-recipes yet. Syrups you create will show up here.</p>
          ) : (
            <p>No cocktails yet. Tap + to add your first.</p>
          )}
        </div>
      ) : (
        <ul className={styles.list}>
          {list.map((r) => {
            const body = (
              <>
                <Link className={styles.cardBody} to={`/recipe/${r.id}`}>
                  <div className={styles.cardMain}>
                    <span className={styles.cardName}>
                      {r.kind === 'component' && (
                        <FlaskIcon size={15} className={styles.cardFlask} />
                      )}
                      {r.name}
                    </span>
                    <span className={styles.cardSub}>{summarize(r)}</span>
                  </div>
                  {r.spirit && r.spirit !== 'none' && filter === 'cocktail' && (
                    <span className={styles.spiritTag}>{r.spirit}</span>
                  )}
                </Link>
                {filter === 'cocktail' && (
                  <button
                    className={`${styles.heart} ${r.favorite ? styles.heartOn : ''}`}
                    aria-label={r.favorite ? 'Unfavorite' : 'Favorite'}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void setFavorite(r.id, !r.favorite)
                    }}
                  >
                    <HeartIcon size={20} filled={!!r.favorite} />
                  </button>
                )}
              </>
            )
            return (
              <li key={r.id}>
                <SwipeableRow onDelete={() => void handleDelete(r)}>
                  <div className={styles.card}>{body}</div>
                </SwipeableRow>
              </li>
            )
          })}
        </ul>
      )}

      <Link className={styles.fab} to="/new" aria-label="New recipe">
        <PlusIcon size={28} />
      </Link>
    </div>
  )
}

async function handleDelete(r: Recipe): Promise<void> {
  // deleting a shared syrup would unlink it from the cocktails that use it —
  // confirm first, then those cocktails keep it as a plain ingredient.
  if (r.kind === 'component') {
    const uses = await countUsage(r.id)
    if (
      uses > 0 &&
      !confirm(
        `“${r.name}” is used in ${uses} cocktail${uses > 1 ? 's' : ''}. Delete it? They'll keep it as a plain ingredient.`,
      )
    ) {
      return
    }
  }
  await deleteRecipe(r.id)
}

function summarize(r: Recipe): string {
  const named = r.ingredients
    .filter((i) => !i.optional)
    .slice(0, 3)
    .map((i) => i.name)
  const extra = r.ingredients.filter((i) => !i.optional).length - named.length
  const base = named.join(' · ')
  if (r.kind === 'component' && r.measureBasis === 'parts') {
    return r.ingredients
      .map((i) => (i.amount !== null ? formatAmount(i.amount, i.unit) : i.name))
      .join(' : ')
  }
  return extra > 0 ? `${base} +${extra}` : base
}
