import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AccentButton } from '../../components/TabBar'
import { ChevronDownIcon, ChevronRightIcon } from '../../components/icons'
import type { PantryItem } from '../../db/schema'
import { bulkAddPantry, removeFromPantry, updateBottle, type BottleInput } from '../../domain/pantry'
import { categoryForName } from '../../domain/spiritCategory'
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

  // Every way into this screen that means "do something" arrives as a query
  // param: the + sheet sends ?add, a recipe ingredient sends ?bottle=… or
  // ?add=<what it calls for>. Consume the intent, then strip it so Back doesn't
  // reopen the sheet you just closed.
  useEffect(() => {
    const wantAdd = params.get('add')
    const wantBottle = params.get('bottle')
    if (!wantAdd && !wantBottle) return
    if (wantBottle && !loaded) return // the shelf hasn't arrived yet

    if (wantAdd) {
      setAddQuery(wantAdd === '1' ? '' : wantAdd)
      setAdding(true)
    }
    if (wantBottle) setViewing(items.find((i) => i.name === wantBottle) ?? null)
    setParams(new URLSearchParams(), { replace: true })
  }, [params, items, loaded, setParams])

  const add = (bottles: BottleInput[]) => {
    if (barId && bottles.length) void bulkAddPantry(barId, bottles)
    setAdding(false)
  }

  const empty = items.length === 0

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.headerText}>
          <div className={styles.count}>{items.length} bottles · <Link className={styles.countLink} to="/?makeable=1">{makeableCount} drinks ready</Link></div>
          <button className={styles.title} onClick={() => setManagingBars(true)}>{barName}<ChevronDownIcon size={18} className={styles.titleChevron} /></button>
        </div>
        <AccentButton label="Bottle" onClick={() => setAdding(true)} />
      </header>

      {empty ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing on this shelf yet</p>
          <p className={styles.emptyHint}>Add the bottles you keep here.</p>
        </div>
      ) : (
        <section className={styles.section}>
          <h2 className={styles.h2}>On the shelf</h2>
          {groups.map((g) => {
            const v = spiritVisual(g.key)
            return (
              <div key={g.key} className={styles.group}>
                <div className={styles.groupHead}>
                  <span className={styles.groupLabel}>{v.label}</span>
                  <span className={styles.groupCount}>{g.items.length}</span>
                </div>
                <div className={styles.items}>
                    {g.items.map((item) => {
                      const v = spiritVisual(item.category ?? categoryForName(item.label) ?? 'other')
                      return (
                        <button className={styles.item} onClick={() => setViewing(item)}>
                          <span className={styles.itemGlyph} style={{ background: v.tint }} aria-hidden>
                            {v.emoji}
                          </span>
                          <span className={styles.itemText}>
                            <span className={styles.itemName}>{item.label}</span>
                            {item.brand && item.brand !== item.label && (
                              <span className={styles.itemSub}>{item.brand}</span>
                            )}
                          </span>
                          <ChevronRightIcon size={18} className={styles.itemChevron} />
                        </button>
                      )
                    })}
                </div>
              </div>
            )
          })}
        </section>
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
        onClose={() => setViewing(null)}
        onRemove={(item) => {
          if (barId) void removeFromPantry(barId, item.name)
          setViewing(null)
        }}
        onSetCategory={(item, category) => {
          if (barId) void updateBottle(barId, item.name, { category })
          setViewing({ ...item, category })
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