import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RecipeRow } from '../components/RecipeRow'
import { SearchIcon } from '../components/icons'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { matchesQuery } from '../domain/search'
import { useCocktails, useComponents } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import styles from './SearchScreen.module.css'

const SUGGESTIONS: { label: string; emoji: string; query?: string; makeable?: boolean }[] = [
  { label: 'Whatever I can make', emoji: '🍸', makeable: true },
  { label: 'Gin', emoji: '🍸', query: 'gin' },
  { label: 'Sour', emoji: '🍋', query: 'sour' },
  { label: 'Lime', emoji: '🟢', query: 'lime' },
  { label: 'Low-ABV', emoji: '🍃', query: 'low' },
  { label: 'Nightcap', emoji: '🌙', query: 'nightcap' },
]

export function SearchScreen() {
  const navigate = useNavigate()
  const cocktails = useCocktails()
  const components = useComponents()
  const { badgeFor } = useAvailability()
  const [query, setQuery] = useState('')

  const q = query.trim()
  const results = useMemo(() => {
    if (!q || !cocktails || !components) return []
    return [...cocktails, ...components].filter((r) => matchesQuery(r, q))
  }, [q, cocktails, components])

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
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                className={styles.chip}
                onClick={() => (s.makeable ? navigate('/browse?makeable=1') : setQuery(s.query ?? ''))}
              >
                <span>{s.emoji}</span>
                {s.label}
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
