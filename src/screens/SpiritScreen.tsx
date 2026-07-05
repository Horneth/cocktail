import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeftIcon, SearchIcon } from '../components/icons'
import { RecipeCard } from '../components/RecipeCard'
import type { Recipe } from '../db/schema'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { tileKeyForRecipe, tileMeta } from '../domain/spirits'
import { useCocktails, useComponents } from '../hooks/useRecipes'
import styles from './SpiritScreen.module.css'

export function SpiritScreen() {
  const { key = 'all' } = useParams()
  const navigate = useNavigate()
  const cocktails = useCocktails()
  const components = useComponents()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const meta = tileMeta(key)
  const isComponents = key === 'components'

  const base = useMemo<Recipe[]>(() => {
    if (isComponents) return components ?? []
    const list = cocktails ?? []
    if (key === 'all') return list
    if (key === 'favorites') return list.filter((c) => c.favorite)
    return list.filter((c) => tileKeyForRecipe(c) === key)
  }, [cocktails, components, key, isComponents])

  const tags = useMemo(() => {
    const count = new Map<string, number>()
    base.forEach((r) => r.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)))
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [base])

  const list = useMemo(
    () => base.filter((r) => matchesQuery(r, query) && (!tag || r.tags.includes(tag))),
    [base, query, tag],
  )

  const mixed = key === 'all' || key === 'favorites'

  return (
    <div className={styles.screen}>
      <header className={styles.header} style={{ background: meta.gradient }}>
        <div className={styles.topRow}>
          <button className={styles.back} aria-label="Back" onClick={() => navigate('/')}>
            <ChevronLeftIcon size={26} />
          </button>
          <span className={styles.emoji}>{meta.emoji}</span>
        </div>
        <h1 className={styles.title}>{meta.label}</h1>
        <div className={styles.search}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${meta.label.toLowerCase()}…`}
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

      {tags.length > 0 && !isComponents && (
        <div className={styles.tags}>
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

      {list.length === 0 ? (
        <p className={styles.empty}>
          {query || tag ? 'No matches here.' : 'Nothing here yet.'}
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
