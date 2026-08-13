import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SwipeableRow } from '../../components/SwipeableRow'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SparkleIcon } from '../../components/icons'
import type { PantryItem } from '../../db/schema'
import { oneAwaySuggestions } from '../../domain/barInsights'
import { closeCandidates, resolveDetections } from '../../domain/bottleMatch'
import type { BottleInput } from '../../domain/pantry'
import { bulkAddPantry, removeFromPantry, updateBottle } from '../../domain/pantry'
import { categoryForName } from '../../domain/spiritCategory'
import { spiritSortIndex } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import { downscaleDataUrl } from '../../import/image'
import { MAX_SCAN_IMAGES } from '../../import/limits'
import { useBottleCounts, useCocktails, useIngredientCatalog, usePantry } from '../../hooks/useRecipes'
import { useAvailability } from '../../hooks/useAvailability'
import { useAssumeStaples } from '../../hooks/useSettings'
import { useAuth } from '../../hooks/useAuth'
import { AddBottleSheet } from './AddBottleSheet'
import { BottleSheet } from './BottleSheet'
import { ManageBarsSheet } from './ManageBarsSheet'
import { ScanReviewSheet, type ScanResult } from './ScanReviewSheet'
import styles from './BarScreen.module.css'

const MAX_SUGGESTIONS = 3

interface Group {
  key: string
  items: PantryItem[]
}

export function BarScreen() {
  const navigate = useNavigate()
  const { barId, bars, setBarId, byId, makeableCount } = useAvailability()
  const { items, have } = usePantry(barId)
  const cocktails = useCocktails()
  const catalog = useIngredientCatalog()
  const barCounts = useBottleCounts()
  const auth = useAuth()
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()

  const [managingBars, setManagingBars] = useState(false)
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState<PantryItem | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fileRef = useRef<HTMLInputElement>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null)

  const activeBar = bars.find((b) => b.id === barId)
  const barName = activeBar?.name ?? 'my bar'
  const drinks = useMemo(() => cocktails ?? [], [cocktails])

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

  // "Buy this next" — one pass over the library, entirely on-device.
  const suggestions = useMemo(
    () => (items.length ? oneAwaySuggestions(drinks, byId, have, assumeStaples, MAX_SUGGESTIONS) : []),
    [items.length, drinks, byId, have, assumeStaples],
  )

  const add = (bottles: BottleInput[]) => {
    if (barId && bottles.length) void bulkAddPantry(barId, bottles)
    setAdding(false)
    setScanResults(null)
  }

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const scanEnabled = auth.aiAvailable
  const onScanFiles = async (files: FileList | null) => {
    if (!files || !files.length || !barId) return
    setScanBusy(true)
    setScanError(null)
    try {
      const chosen = [...files].slice(0, MAX_SCAN_IMAGES)
      const images = await Promise.all(chosen.map((f) => downscaleDataUrl(f)))
      const { cloudIdentifyBottles, cloudReconcileBottles } = await import('../../import/cloudAI')

      // Pass 1: what's on the shelf.
      const detected = await cloudIdentifyBottles(images)

      // Between the passes, on-device: which of the user's own bottles is each
      // detection even worth comparing against. Only those few names travel —
      // never the inventory — and a bottle with no lookalike never gets asked
      // about at all, so a scan into an empty bar costs a single call.
      const inputs = detected.map((d) => ({
        detected: d.name,
        ...(d.category ? { category: d.category } : {}),
        candidates: closeCandidates(d, items).map((c) => c.label),
      }))

      // Pass 2 is an enhancement, not a dependency — it resolves to [] rather
      // than throwing, and the local verdicts still drive a usable review sheet.
      const reconciled = await cloudReconcileBottles(inputs)

      setScanResults(resolveDetections(detected, items, reconciled))
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Could not scan those photos.')
    } finally {
      setScanBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const empty = items.length === 0

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.count}>
          {items.length} bottle{items.length === 1 ? '' : 's'} · {makeableCount} drink
          {makeableCount === 1 ? '' : 's'}
        </div>
        <button className={styles.title} onClick={() => setManagingBars(true)}>
          {barName}
          <ChevronDownIcon size={20} className={styles.titleChevron} />
        </button>
      </div>

      <button
        className={styles.hero}
        onClick={() => navigate(makeableCount > 0 ? '/browse?makeable=1' : '/browse')}
      >
        <span className={styles.heroNum}>{makeableCount}</span>
        <span className={styles.heroText}>
          drinks you can make
          <span className={styles.heroHint}>
            {empty ? 'Add your first bottle to get started' : 'from what’s on your shelf right now'}
          </span>
        </span>
        <span className={styles.heroBtn}>View</span>
      </button>

      <div className={styles.paths}>
        <button className={styles.path} onClick={() => setAdding(true)}>
          <span className={styles.pathGlyph} aria-hidden>
            🍾
          </span>
          <span className={styles.pathText}>
            <span className={styles.pathTitle}>Add a bottle</span>
            <span className={styles.pathSub}>Search your recipes or type any name</span>
          </span>
          <ChevronRightIcon size={20} className={styles.pathChevron} />
        </button>

        {scanEnabled && (
          <button
            className={styles.pathAccent}
            onClick={() => fileRef.current?.click()}
            disabled={scanBusy}
          >
            <span className={styles.pathGlyph} aria-hidden>
              📷
            </span>
            <span className={styles.pathText}>
              <span className={styles.pathTitle}>{scanBusy ? 'Reading your shelf…' : 'Scan my shelf'}</span>
              <span className={styles.pathSub}>
                {scanBusy ? 'This takes a few seconds' : 'Photograph the labels and we’ll sort them out'}
              </span>
            </span>
            <SparkleIcon size={19} className={styles.pathSparkle} />
          </button>
        )}
        {!scanEnabled && auth.configured && (
          <button className={styles.signIn} onClick={() => void auth.signIn()}>
            <SparkleIcon size={15} /> Sign in with Google to scan your shelf from a photo
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void onScanFiles(e.target.files)}
      />
      {scanError && <p className={styles.scanError}>{scanError}</p>}

      {suggestions.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Worth buying next</h2>
          <div className={styles.suggestions}>
            {suggestions.map((s) => {
              const v = spiritVisual(categoryForName(s.label) ?? 'other')
              const first = byId.get(s.recipeIds[0])
              return (
                <button
                  key={s.name}
                  className={styles.suggestion}
                  onClick={() => barId && void bulkAddPantry(barId, [{ label: s.label }])}
                >
                  <span className={styles.suggestionGlyph} style={{ background: v.tint }} aria-hidden>
                    {v.emoji}
                  </span>
                  <span className={styles.suggestionText}>
                    <span className={styles.suggestionName}>{s.label}</span>
                    <span className={styles.suggestionSub}>
                      unlocks {first?.name ?? 'a drink'}
                      {s.unlocks > 1 && ` +${s.unlocks - 1} more`}
                    </span>
                  </span>
                  <span className={styles.suggestionAdd}>
                    <PlusIcon size={17} />
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {empty ? (
        <div className={styles.empty}>
          <div className={styles.emptyGlyph} aria-hidden>
            🥃
          </div>
          <p className={styles.emptyTitle}>{barName} is empty</p>
          <p className={styles.emptyHint}>
            Add the bottles you own and every recipe learns what you can make.
          </p>
        </div>
      ) : (
        <section className={styles.section}>
          <h2 className={styles.h2}>On the shelf</h2>
          {groups.map((g) => {
            const v = spiritVisual(g.key)
            const isCollapsed = collapsed.has(g.key)
            return (
              <div key={g.key} className={styles.group}>
                <button className={styles.groupHead} onClick={() => toggleCollapse(g.key)}>
                  <span className={styles.groupGlyph} style={{ background: v.tint }} aria-hidden>
                    {v.emoji}
                  </span>
                  <span className={styles.groupLabel}>{v.label}</span>
                  <span className={styles.groupCount}>{g.items.length}</span>
                  <ChevronDownIcon
                    size={17}
                    className={`${styles.groupChevron} ${isCollapsed ? styles.groupChevronUp : ''}`}
                  />
                </button>
                {!isCollapsed && (
                  <div className={styles.items}>
                    {g.items.map((item) => (
                      <SwipeableRow
                        key={item.name}
                        onDelete={() => barId && void removeFromPantry(barId, item.name)}
                      >
                        <button className={styles.item} onClick={() => setViewing(item)}>
                          <span className={styles.itemText}>
                            <span className={styles.itemName}>{item.label}</span>
                            {item.brand && item.brand !== item.label && (
                              <span className={styles.itemSub}>{item.brand}</span>
                            )}
                          </span>
                          <ChevronRightIcon size={18} className={styles.itemChevron} />
                        </button>
                      </SwipeableRow>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      <label className={styles.staples}>
        <span className={styles.staplesText}>
          <span className={styles.staplesTitle}>Assume I have the basics</span>
          <span className={styles.staplesHint}>water, ice, citrus, sugar, sodas, garnishes, egg</span>
        </span>
        <input
          type="checkbox"
          className={styles.switch}
          checked={assumeStaples}
          onChange={(e) => setAssumeStaples(e.target.checked)}
        />
      </label>

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
        onClose={() => setAdding(false)}
        onAdd={add}
        catalog={catalog}
        have={have}
        cocktails={drinks}
        byId={byId}
        assumeStaples={assumeStaples}
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

      <ScanReviewSheet
        results={scanResults}
        onClose={() => setScanResults(null)}
        onAdd={add}
        barName={barName}
        have={have}
        cocktails={drinks}
        byId={byId}
        assumeStaples={assumeStaples}
      />
    </div>
  )
}
