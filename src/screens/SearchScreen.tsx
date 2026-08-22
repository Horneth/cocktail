import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RecipeRow } from '../components/RecipeRow'
import { SearchIcon } from '../components/icons'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { tagEmoji } from '../domain/vocab'
import { useCocktails, useMixers } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import styles from './SearchScreen.module.css'

const MAX_TAG_CHIPS = 6

/**
 * The app's one search field. Home and Browse carry a launcher pill that lands
 * here rather than each growing an input of their own.
 *
 * The query lives in the URL so a search can be linked to, and so backing out of
 * a recipe returns to the results you left rather than an empty box.
 */
export function SearchScreen() {
  const navigate = useNavigate()
  const cocktails = useCocktails()
  const mixers = useMixers()
  const { badgeFor, have } = useAvailability()
  const [params, setParams] = useSearchParams()

  const query = params.get('q') ?? ''
  const setQuery = (value: string) =>
    setParams(value ? { q: value } : {}, { replace: true })

  // Starting points taken from the library itself — a hard-coded list ends up
  // advertising tags the user's own recipes don't have.
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of cocktails ?? []) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TAG_CHIPS)
      .map(([t]) => t)
  }, [cocktails])

  const q = query.trim()
  const results = useMemo(() => {
    if (!q || !cocktails || !mixers) return []
    return [...cocktails, ...mixers].filter((r) => matchesQuery(r, q))
  }, [q, cocktails, mixers])

  return (
    <div className={styles.screen}>
      <div className={styles.searchBar}>
        <SearchIcon size={19} className={styles.searchIcon} />
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drinks, spirits, ingredients"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {q && (
          <button className={styles.clear} onClick={() => setQuery('')} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      {!q ? (
        <div>
          <div className={styles.suggestLabel}>Try searching</div>
          <div className={styles.suggestions}>
            {have.size > 0 && (
              <button className={styles.chip} onClick={() => navigate('/browse?makeable=1')}>
                <span>🍸</span>
                Whatever I can make
              </button>
            )}
            {tags.map((t) => (
              <button key={t} className={styles.chip} onClick={() => setQuery(t)}>
                <span>{tagEmoji(t)}</span>
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyEmoji}>🔍</div>
          <p className={styles.emptyText}>Nothing for “{q}”</p>
          <button className={styles.importBtn} onClick={() => navigate('/import')}>
            Import a recipe
          </button>
        </div>
      ) : (
        <div>
          <div className={styles.count}>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </div>
          <div className={styles.list}>
            {results.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                badge={badgeFor(r)}
                onDelete={() => void deleteRecipeWithConfirm(r)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
