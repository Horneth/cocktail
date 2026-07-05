import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GearIcon, ImportIcon, PlusIcon, SearchIcon } from '../components/icons'
import { RecipeCard } from '../components/RecipeCard'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { SPIRIT_TILES, tileKeyForRecipe, tileMeta } from '../domain/spirits'
import { useCocktails, useComponents } from '../hooks/useRecipes'
import styles from './HomeScreen.module.css'

interface Tile {
  key: string
  count: number
}

export function HomeScreen() {
  const cocktails = useCocktails()
  const components = useComponents()
  const [query, setQuery] = useState('')

  const tiles = useMemo<Tile[]>(() => {
    if (!cocktails || !components) return []
    const counts = new Map<string, number>()
    let favs = 0
    for (const c of cocktails) {
      counts.set(tileKeyForRecipe(c), (counts.get(tileKeyForRecipe(c)) ?? 0) + 1)
      if (c.favorite) favs++
    }
    const out: Tile[] = []
    if (cocktails.length) out.push({ key: 'all', count: cocktails.length })
    if (favs) out.push({ key: 'favorites', count: favs })
    for (const t of SPIRIT_TILES) {
      const n = counts.get(t.key) ?? 0
      if (n) out.push({ key: t.key, count: n })
    }
    if (components.length) out.push({ key: 'components', count: components.length })
    return out
  }, [cocktails, components])

  const topTags = useMemo(() => {
    if (!cocktails) return []
    const count = new Map<string, number>()
    cocktails.forEach((c) => c.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([t]) => t)
  }, [cocktails])

  const results = useMemo(() => {
    if (!query.trim() || !cocktails || !components) return []
    return [...cocktails, ...components].filter((r) => matchesQuery(r, query))
  }, [query, cocktails, components])

  const searching = query.trim() !== ''

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
            <Link className={styles.gearBtn} to="/settings" aria-label="Settings">
              <GearIcon size={20} />
            </Link>
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
      </header>

      {searching ? (
        results.length === 0 ? (
          <p className={styles.empty}>No matches for “{query}”.</p>
        ) : (
          <ul className={styles.list}>
            {results.map((r) => (
              <li key={r.id}>
                <RecipeCard
                  recipe={r}
                  showSpirit
                  onDelete={() => void deleteRecipeWithConfirm(r)}
                />
              </li>
            ))}
          </ul>
        )
      ) : tiles.length === 0 ? (
        <div className={styles.empty}>
          <p>No cocktails yet.</p>
          <p className={styles.emptyHint}>Tap ＋ to add one, or Import from a video.</p>
        </div>
      ) : (
        <>
          <div className={styles.mosaic}>
            {tiles.map((t) => {
              const m = tileMeta(t.key)
              return (
                <Link
                  key={t.key}
                  className={styles.tile}
                  to={`/browse?scope=${t.key}`}
                  style={{ background: m.gradient }}
                >
                  <span className={styles.tileEmoji}>{m.emoji}</span>
                  <span className={styles.tileLabel}>{m.label}</span>
                  <span className={styles.tileCount}>
                    {t.count} {t.count === 1 ? 'recipe' : 'recipes'}
                  </span>
                </Link>
              )
            })}
          </div>

          {topTags.length > 0 && (
            <section className={styles.tagSection}>
              <h2 className={styles.tagSectionTitle}>Browse by tag</h2>
              <div className={styles.tagPills}>
                {topTags.map((t) => (
                  <Link key={t} className={styles.tagPill} to={`/browse?tags=${encodeURIComponent(t)}`}>
                    #{t}
                  </Link>
                ))}
                <Link className={styles.tagPillMore} to="/browse">
                  All tags →
                </Link>
              </div>
            </section>
          )}
        </>
      )}

      <Link className={styles.fab} to="/new" aria-label="New recipe">
        <PlusIcon size={28} />
      </Link>
    </div>
  )
}
