import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { RecipeRow } from '../components/RecipeRow'
import { SearchLauncher } from '../components/SearchLauncher'
import { BottleIcon, ChevronRightIcon, GearIcon } from '../components/icons'
import { deleteRecipeWithConfirm } from '../domain/recipeActions'
import { spiritSortIndex, tileKeyForRecipe } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { useCocktails } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import styles from './HomeScreen.module.css'

function greetingForHour(h: number): string {
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function HomeScreen() {
  const cocktails = useCocktails()
  const { makeableCount, badgeFor, barId, bars, setBarId } = useAvailability()

  const barName = bars.find((b) => b.id === barId)?.name ?? 'My Bar'
  const cycleBar = () => {
    if (bars.length < 2 || !barId) return
    const i = bars.findIndex((b) => b.id === barId)
    setBarId(bars[(i + 1) % bars.length].id)
  }

  const spiritTiles = useMemo(() => {
    if (!cocktails) return []
    const counts = new Map<string, number>()
    for (const c of cocktails) {
      const k = tileKeyForRecipe(c)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => spiritSortIndex(a[0]) - spiritSortIndex(b[0]) || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count }))
  }, [cocktails])

  const recent = useMemo(
    () => (cocktails ? [...cocktails].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4) : []),
    [cocktails],
  )

  const greeting = greetingForHour(new Date().getHours())

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.greeting}>{greeting}</div>
          <h1 className={styles.title}>What can you pour?</h1>
        </div>
        <div className={styles.headerActions}>
          {/* Only a switcher when there's something to switch to — cycleBar()
              no-ops below two bars, so for most people this pill was an inert
              120px of header. The hero card names the active bar anyway. */}
          {bars.length > 1 && (
            <button className={styles.barPill} onClick={cycleBar} aria-label="Switch bar">
              <span className={styles.barDot} />
              <span className={styles.barName}>{barName}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
              </svg>
            </button>
          )}
          {/* Home is where every session starts, so it's the one place a
              rarely-visited destination like Settings stays findable. */}
          <Link className={styles.gear} to="/settings" aria-label="Settings">
            <GearIcon size={19} />
          </Link>
        </div>
      </header>

      <SearchLauncher />

      {/* What you can pour is a fact worth one line, not a billboard. It used to
          be a full-width accent card and it made every visit to Home an argument
          about the size of your bar. */}
      <Link className={styles.ready} to={makeableCount > 0 ? '/browse?makeable=1' : '/bar'}>
        <BottleIcon size={16} className={styles.readyIcon} />
        <span className={styles.readyText}>
          {makeableCount > 0 ? (
            <>
              <b>{makeableCount}</b> ready at {barName}
            </>
          ) : (
            <>Nothing ready at {barName} yet</>
          )}
        </span>
        <ChevronRightIcon size={16} className={styles.readyChevron} />
      </Link>

      {spiritTiles.length > 0 && (
        <section>
          <div className={styles.sectionHead}>
            <h2 className={styles.h2}>Browse by spirit</h2>
            <Link className={styles.seeAll} to="/browse">
              See all
            </Link>
          </div>
          <div className={`${styles.rail} hg-scroll`}>
            {spiritTiles.map(({ key, count }) => {
              const v = spiritVisual(key)
              return (
                <Link key={key} className={styles.spiritCard} to={`/browse?scope=${key}`}>
                  <span className={styles.spiritChip} style={{ background: v.dot }}>
                    {v.emoji}
                  </span>
                  <span className={styles.spiritLabel}>{v.label}</span>
                  <span className={styles.spiritCount}>
                    {count} {count === 1 ? 'recipe' : 'recipes'}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className={styles.recentSection}>
          <div className={styles.sectionHead}>
            <h2 className={styles.h2}>Recently added</h2>
            <Link className={styles.seeAll} to="/browse">
              See all
            </Link>
          </div>
          <div className={styles.list}>
            {recent.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                badge={badgeFor(r)}
                onDelete={() => void deleteRecipeWithConfirm(r)}
              />
            ))}
          </div>
        </section>
      )}

      {cocktails && cocktails.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyEmoji}>🍸</div>
          <p className={styles.emptyTitle}>No cocktails yet</p>
          <p className={styles.emptyHint}>Tap ＋ below to import or build your first drink.</p>
        </div>
      )}
    </div>
  )
}
