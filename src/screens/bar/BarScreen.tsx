import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AccentButton } from '../../components/TabBar'
import { BottleArt } from '../../components/BottleArt'
import { BottleCard } from '../../components/BottleCard'
import { ChevronDownIcon } from '../../components/icons'
import type { PantryItem } from '../../db/schema'
import { bulkAddPantry, removeFromPantry, updateBottle, type BottleInput } from '../../domain/pantry'
import { queueBottleImageGeneration } from '../../import/bottleImageQueue'
import { categoryForName } from '../../domain/spiritCategory'
import { oneAwaySuggestions, recipesUsingBottle, starterShelf } from '../../domain/barInsights'
import { spiritSortIndex } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import { useBottleCounts, useCocktails, useIngredientCatalog, usePantry } from '../../hooks/useRecipes'
import { useAvailability } from '../../hooks/useAvailability'
import { useAssumeStaples } from '../../hooks/useSettings'
import { AddBottleSheet } from './AddBottleSheet'
import { BottleSheet } from './BottleSheet'
import { ManageBarsSheet } from './ManageBarsSheet'
import styles from './BarScreen.module.css'

interface Group {
  key: string
  items: PantryItem[]
}

export function BarScreen() {
  const { barId, bars, setBarId, byId, makeableCount } = useAvailability()
  const { items, have, loaded } = usePantry(barId)
  const cocktails = useCocktails()
  const catalog = useIngredientCatalog()
  const barCounts = useBottleCounts()
  const [assumeStaples] = useAssumeStaples()

  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { name: bottleRouteName } = useParams()
  const [managingBars, setManagingBars] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [viewing, setViewing] = useState<PantryItem | null>(null)

  const activeBar = bars.find((b) => b.id === barId)
  const barName = activeBar?.name ?? 'my bar'
  const drinks = cocktails ?? []

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, PantryItem[]>()
    for (const item of items) {
      const key = item.category ?? categoryForName(item.label) ?? 'other'
      const group = byKey.get(key)
      if (group) group.push(item)
      else byKey.set(key, [item])
    }
    return [...byKey.entries()]
      .map(([key, rows]) => ({ key, items: rows.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => {
        if (a.key === 'other') return 1
        if (b.key === 'other') return -1
        return spiritSortIndex(a.key) - spiritSortIndex(b.key) || a.key.localeCompare(b.key)
      })
  }, [items])

  // The payoff line under each card: how many library drinks the bottle pours
  // into — the availability engine's own answer, ready-now or not.
  const pours = useMemo(() => {
    const m = new Map<string, number>()
    for (const item of items) {
      m.set(item.name, recipesUsingBottle(item.label, drinks, byId, item.category).length)
    }
    return m
  }, [items, drinks, byId])

  // The bottles most worth buying next, from the same on-device engine the add
  // sheet ranks with. Tapping one opens the sheet prefilled. Empty shelves get
  // the starter set instead — with nothing stocked, nothing is "one away".
  const oneAway = useMemo(
    () => (items.length ? oneAwaySuggestions(drinks, byId, have, assumeStaples, 6) : []),
    [items.length, drinks, byId, have, assumeStaples],
  )
  const starters = useMemo(() => (items.length ? [] : starterShelf(drinks, 6)), [items.length, drinks])

  // Every way into this screen that means "do something" arrives as a query
  // param: the + sheet sends ?add, a recipe ingredient sends ?bottle=… or
  // ?add=<what it calls for>. Consume the intent, then strip it so Back doesn't
  // reopen the sheet you just closed.
  useEffect(() => {
    const wantAdd = params.get('add')
    const wantBottle = params.get('bottle')
    if (bottleRouteName) {
      if (loaded) setViewing(items.find((i) => i.name === bottleRouteName) ?? null)
      return
    }
    setViewing(null)
    if (!wantAdd && !wantBottle) return
    if (wantBottle && !loaded) return

    if (wantAdd) {
      setAddQuery(wantAdd === '1' ? '' : wantAdd)
      setAdding(true)
    }
    if (wantBottle) setViewing(items.find((i) => i.name === wantBottle) ?? null)
    setParams(new URLSearchParams(), { replace: true })
  }, [params, items, loaded, setParams, bottleRouteName])

  const add = (bottles: BottleInput[]) => {
    if (barId && bottles.length) {
      void bulkAddPantry(barId, bottles).then(queueBottleImageGeneration)
    }
    setAdding(false)
  }

  const addStarters = (labels: string[]) => {
    if (barId && labels.length) {
      void bulkAddPantry(barId, labels.map((label) => ({ label }))).then(queueBottleImageGeneration)
    }
  }

  const empty = items.length === 0
  const closeBottle = () => {
    setViewing(null)
    if (bottleRouteName) navigate('/bar', { replace: true })
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.headerText}>
          <div className={styles.count}>{items.length} bottle{items.length === 1 ? '' : 's'} · <Link className={styles.countLink} to="/?makeable=1">{makeableCount} drink{makeableCount === 1 ? '' : 's'} ready</Link></div>
          <button className={styles.title} onClick={() => setManagingBars(true)}>{barName}<ChevronDownIcon size={18} className={styles.titleChevron} /></button>
        </div>
        <AccentButton label="Bottle" onClick={() => setAdding(true)} />
      </header>

      {empty ? (
        starters.length ? (
          <div className={styles.starters}>
            <p className={styles.startersTitle}>Start with the essentials</p>
            <div className={styles.starterGrid}>
              {starters.map((s) => {
                const category = categoryForName(s.label) ?? 'other'
                const v = spiritVisual(category)
                return (
                  <button key={s.name} className={styles.starter} onClick={() => addStarters([s.label])}>
                    <span className={styles.starterArt} style={{ background: v.tint }} aria-hidden>
                      <BottleArt name={s.label} category={category} size={64} />
                    </span>
                    <span className={styles.starterName}>{s.label}</span>
                    <span className={styles.starterCount}>in {s.recipes} drink{s.recipes > 1 ? 's' : ''}</span>
                  </button>
                )
              })}
            </div>
            <button className={styles.starterAll} onClick={() => addStarters(starters.map((s) => s.label))}>
              Add all {starters.length}
            </button>
          </div>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Nothing on this shelf yet</p>
            <p className={styles.emptyHint}>Add the bottles you keep here.</p>
          </div>
        )
      ) : (
        <>
          {oneAway.length > 0 && (
            <section className={styles.away}>
              <p className={styles.awayTitle}>One away</p>
              <div className={styles.awayRow}>
                {oneAway.map((s) => (
                  <button
                    key={s.name}
                    className={styles.awayChip}
                    onClick={() => {
                      setAddQuery(s.label)
                      setAdding(true)
                    }}
                  >
                    {s.label}
                    <b className={styles.awayCount}>+{s.unlocks}</b>
                  </button>
                ))}
              </div>
            </section>
          )}

          {groups.map((g) => {
            const v = spiritVisual(g.key)
            return (
              <section key={g.key} className={styles.group}>
                <div className={styles.groupHead}>
                  <span className={styles.groupDot} style={{ background: v.dot }} aria-hidden />
                  <span className={styles.groupLabel}>{v.label}</span>
                  <span className={styles.groupCount}>{g.items.length}</span>
                </div>
                <div className={styles.grid}>
                  {g.items.map((item) => (
                    <BottleCard
                      key={item.name}
                      label={item.label}
                      brand={item.brand}
                       category={item.category ?? categoryForName(item.label) ?? 'other'}
                       image={item.image}
                       imageStatus={item.imageStatus}
                       pours={pours.get(item.name) ?? 0}
                       onClick={() => navigate(`/bar/bottle/${encodeURIComponent(item.name)}`)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}

      <ManageBarsSheet
        open={managingBars}
        onClose={() => setManagingBars(false)}
        bars={bars}
        activeId={barId}
        onSelect={setBarId}
        counts={barCounts}
      />

      <AddBottleSheet
        open={adding}
        initialQuery={addQuery}
        onClose={() => {
          setAdding(false)
          setAddQuery('')
        }}
        onAdd={add}
        catalog={catalog}
        have={have}
        items={items}
        cocktails={drinks}
        byId={byId}
        assumeStaples={assumeStaples}
        barName={barName}
        presentation="screen"
      />

      <BottleSheet
        bottle={viewing}
         onClose={closeBottle}
         onRemove={(item) => {
           if (barId) void removeFromPantry(barId, item.name)
           closeBottle()
         }}
         onSetCategory={(item, category) => {
           const next = { ...item, category, image: undefined, imageStatus: 'none' as const, imageError: undefined }
           if (barId) void updateBottle(barId, item.name, { category, image: undefined, imageStatus: 'none', imageError: undefined })
           setViewing(next)
           queueBottleImageGeneration([next])
         }}
         onRetryImage={(item) => {
           queueBottleImageGeneration([item])
           setViewing({ ...item, imageStatus: 'pending', imageError: undefined })
         }}
         barName={barName}
        cocktails={drinks}
        byId={byId}
        have={have}
        assumeStaples={assumeStaples}
      />
    </div>
  )
}
