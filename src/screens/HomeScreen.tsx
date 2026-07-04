import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskIcon, PlusIcon, SearchIcon } from '../components/icons'
import type { Recipe } from '../db/schema'
import { formatAmount } from '../domain/units'
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

  const source = filter === 'cocktail' ? cocktails : components

  const spirits = useMemo(() => {
    const set = new Set<string>()
    cocktails?.forEach((c) => c.spirit && c.spirit !== 'none' && set.add(c.spirit))
    return [...set].sort()
  }, [cocktails])

  const list = useMemo(() => {
    if (!source) return []
    return source.filter(
      (r) => matches(r, query) && (filter === 'component' || !spirit || r.spirit === spirit),
    )
  }, [source, query, spirit, filter])

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Cocktails</h1>
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

        {filter === 'cocktail' && spirits.length > 0 && (
          <div className={styles.chips}>
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
      </header>

      {source === undefined ? (
        <p className={styles.empty}>…</p>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          {query ? (
            <p>No matches for “{query}”.</p>
          ) : filter === 'component' ? (
            <p>No sub-recipes yet. Syrups you create will show up here.</p>
          ) : (
            <p>No cocktails yet. Tap + to add your first.</p>
          )}
        </div>
      ) : (
        <ul className={styles.list}>
          {list.map((r) => (
            <li key={r.id}>
              <Link className={styles.card} to={`/recipe/${r.id}`}>
                <div className={styles.cardMain}>
                  <span className={styles.cardName}>
                    {r.kind === 'component' && <FlaskIcon size={15} className={styles.cardFlask} />}
                    {r.name}
                  </span>
                  <span className={styles.cardSub}>{summarize(r)}</span>
                </div>
                {r.spirit && r.spirit !== 'none' && filter === 'cocktail' && (
                  <span className={styles.spiritTag}>{r.spirit}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link className={styles.fab} to="/new" aria-label="New recipe">
        <PlusIcon size={28} />
      </Link>
    </div>
  )
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
