import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Recipe } from '../../db/schema'
import { CheckIcon, ChevronDownIcon, PlusIcon } from '../../components/icons'
import { RecipeImage } from '../../components/RecipeImage'
import { missingBottles } from '../../domain/availability'
import { catalog, pickLineup, styleLabel, type CatalogEntry } from '../../domain/lineup'
import { displayImage } from '../../domain/imagePool'
import { matchesQuery } from '../../domain/search'
import { tileKeyForRecipe } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import { useBottleCounts, useIngredientCatalog } from '../../hooks/useRecipes'
import { useServe } from '../../hooks/useServe'
import { bulkAddPantry, type BottleInput } from '../../domain/pantry'
import { AddBottleSheet } from '../bar/AddBottleSheet'
import { ManageBarsSheet } from '../bar/ManageBarsSheet'
import styles from './ServeScreen.module.css'

// "Pour a round": a view over the active bar plus a curated menu. The bar line
// names the context (My Bar at home; "Pour elsewhere" for a borrowed place) —
// chips and shopping-list pills are both quick edits to that bar's shelf, so
// the badges can never disagree with what's actually stocked. The menu is the
// host's own list; the catalog presents every drink with its status as a
// decision input and never decides a section for them.

type Segment = 'ready' | 'close' | 'all'

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'ready', label: 'Ready' },
  { key: 'close', label: 'One away' },
  { key: 'all', label: 'All' },
]

const EMPTY_LINE: Record<Segment, string> = {
  ready: "Nothing ready yet — add a bottle to the bar above.",
  close: 'Nothing one bottle away right now.',
  all: 'No drinks yet — add a recipe first.',
}

export function ServeScreen() {
  const serve = useServe()
  const counts = useBottleCounts()
  const ingredientCatalog = useIngredientCatalog()
  const [showBars, setShowBars] = useState(false)
  const [adding, setAdding] = useState(false)
  const [segment, setSegment] = useState<Segment>('ready')
  const [query, setQuery] = useState('')

  const entries = useMemo(
    () => catalog(serve.cocktails, serve.byId, serve.have, serve.assumeStaples),
    [serve.cocktails, serve.byId, serve.have, serve.assumeStaples],
  )
  const segCount = (tier: 'ready' | 'close') => entries.filter((e) => e.tier === tier).length
  const visible = useMemo(
    () => (segment === 'all' ? entries : entries.filter((e) => e.tier === segment)).filter((e) => matchesQuery(e.recipe, query)),
    [entries, segment, query],
  )

  const menuIds = useMemo(() => new Set(serve.menu.map((r) => r.id)), [serve.menu])
  const readyInMenu = serve.menu.filter((r) => serve.makeable.has(r.id)).length

  const trio = useMemo(
    () =>
      serve.menu.length === 0
        ? pickLineup(serve.cocktails, serve.byId, serve.have, serve.assumeStaples, 3)
        : [],
    [serve.menu.length, serve.cocktails, serve.byId, serve.have, serve.assumeStaples],
  )

  if (!serve.loaded) return null

  const badge = (r: Recipe) => {
    if (serve.makeable.has(r.id)) return <span className={`${styles.status} ${styles.ok}`}>Ready</span>
    const missing =
      entries.find((e) => e.recipe.id === r.id)?.missing ??
      missingBottles(r, serve.have, serve.byId, serve.assumeStaples)
    return missing.length === 1 ? (
      <span className={`${styles.status} ${styles.near}`}>Needs {missing[0]}</span>
    ) : (
      <span className={`${styles.status} ${styles.short}`}>{missing.length} missing</span>
    )
  }

  const thumb = (r: Recipe) => {
    const v = spiritVisual(tileKeyForRecipe(r))
    return (
      <RecipeImage
        image={displayImage(r)}
        size="thumb"
        sizes="48px"
        className={styles.thumbImg}
        generating={r.imageStatus === 'pending'}
        fallback={
          <span className={styles.thumb} style={{ background: v.tint }} aria-hidden>
            {v.emoji}
          </span>
        }
      />
    )
  }


  const menuRow = (r: Recipe) => (
    <div key={r.id} className={styles.actionRow}>
      <Link className={styles.row} to={`/recipe/${r.id}`}>
        {thumb(r)}
        <span className={styles.main}>
          <span className={styles.name}>{r.name}</span>
          <span className={styles.style}>{styleLabel(r)}</span>
          {badge(r)}
        </span>
      </Link>
      <button
        className={styles.minus}
        aria-label={`Remove ${r.name} from the menu`}
        onClick={() => serve.toggleMenu(r.id, false)}
      >
        –
      </button>
    </div>
  )

  const catalogRow = (e: CatalogEntry) => {
    const inMenu = menuIds.has(e.recipe.id)
    return (
      <div key={e.recipe.id} className={styles.actionRow}>
        <Link className={styles.row} to={`/recipe/${e.recipe.id}`}>
          {thumb(e.recipe)}
          <span className={styles.main}>
            <span className={styles.name}>{e.recipe.name}</span>
            <span className={styles.style}>{e.style}</span>
            {badge(e.recipe)}
          </span>
        </Link>
        <button
          className={`${styles.plus} ${inMenu ? styles.plusOn : ''}`}
          aria-label={inMenu ? `Remove ${e.recipe.name} from the menu` : `Add ${e.recipe.name} to the menu`}
          onClick={() => serve.toggleMenu(e.recipe.id, !inMenu)}
        >
          {inMenu ? <CheckIcon size={18} /> : <PlusIcon size={18} />}
        </button>
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pour a round</h1>
      </header>

      <div className={styles.barLine}>
        <button className={styles.barPick} onClick={() => setShowBars(true)}>
          <span>
            {serve.barName} · {serve.barCount} {serve.barCount === 1 ? 'bottle' : 'bottles'}
          </span>
          <ChevronDownIcon size={13} />
        </button>
        <button className={styles.elsewhere} onClick={() => void serve.pourElsewhere()}>
          Pour elsewhere
        </button>
      </div>

      <div className={styles.barActions}>
        <button className={styles.addBottle} onClick={() => setAdding(true)}>
          Add a bottle
        </button>
      </div>

      {trio.length >= 2 && (
        <div className={styles.trio}>
          <span className={styles.trioText}>
            A starter three: {trio.map((e) => e.recipe.name).join(', ')}
          </span>
          <button
            className={styles.trioAdd}
            onClick={() => trio.forEach((e) => serve.toggleMenu(e.recipe.id, true))}
          >
            Add
          </button>
        </div>
      )}

      {serve.menu.length > 0 && (
        <>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Your menu</h2>
            <button className={styles.clear} onClick={serve.clearMenu}>
              Clear
            </button>
          </div>
          <p className={styles.menuCount}>
            {readyInMenu} of {serve.menu.length} ready now
          </p>
          <div className={styles.rows}>
            {serve.menu.map((r) => menuRow(r))}
          </div>
          <Link className={styles.shoppingLink} to="/serve/list">
            Shopping list
          </Link>
        </>
      )}

      {serve.have.size === 0 && (
        <div className={styles.empty}>
          <h2>Tap what's around</h2>
          <p>Add a bottle to this bar — the drinks you can pour show up below.</p>
        </div>
      )}

      <div className={styles.catalogHead}>
        <h2 className={styles.sectionTitle}>Add drinks</h2>
      </div>
      <div className={styles.searchBar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search drinks or ingredients"
          aria-label="Search drinks or ingredients"
        />
      </div>
      <div className={`${styles.segBar} hg-scroll`}>
        <div className={styles.segTrack}>
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              className={`${styles.chip} ${segment === s.key ? styles.chipOn : ''}`}
              aria-pressed={segment === s.key}
              onClick={() => setSegment(s.key)}
            >
              {s.label} {s.key === 'all' ? entries.length : segCount(s.key)}
            </button>
          ))}
        </div>
      </div>

      {visible.length > 0 ? (
        <div className={styles.rows}>{visible.map(catalogRow)}</div>
      ) : (
        <p className={styles.emptyList}>{EMPTY_LINE[segment]}</p>
      )}

      <ManageBarsSheet
        open={showBars}
        onClose={() => setShowBars(false)}
        bars={serve.bars}
        activeId={serve.barId}
        onSelect={serve.setBarId}
        counts={counts}
      />

      <AddBottleSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(bottles: BottleInput[]) => {
          if (serve.barId) void bulkAddPantry(serve.barId, bottles)
          setAdding(false)
        }}
        catalog={ingredientCatalog}
        have={serve.have}
        items={serve.items}
        cocktails={serve.cocktails}
        byId={serve.byId}
        assumeStaples={serve.assumeStaples}
        barName={serve.barName}
        presentation="screen"
      />
    </div>
  )
}