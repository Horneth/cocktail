import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { useBottleCounts, useCocktails, useIngredientCatalog, usePantry } from '../../hooks/useRecipes'
import { useAvailability } from '../../hooks/useAvailability'
import { useAssumeStaples } from '../../hooks/useSettings'
import { useAuth } from '../../hooks/useAuth'
import { AddBottleSheet } from './AddBottleSheet'
import { BottleSheet } from './BottleSheet'
import { ManageBarsSheet } from './ManageBarsSheet'
import { ScanReviewSheet, type ScanResult } from './ScanReviewSheet'
import styles from './BarScreen.module.css'

// Four photos is enough for a home shelf and keeps the vision payload (and its
// cost) bounded; `downscaleDataUrl` shrinks each one before it leaves the device.
const MAX_SCAN_IMAGES = 4
const MAX_SUGGESTIONS = 3

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
  const auth = useAuth()
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()

  const [params, setParams] = useSearchParams()
  const [managingBars, setManagingBars] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [viewing, setViewing] = useState<PantryItem | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fileRef = useRef<HTMLInputElement>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanIntent, setScanIntent] = useState(false)
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

  // Every way into this screen that means "do something" arrives as a query
  // param: the + sheet sends ?add / ?scan, a recipe ingredient sends ?bottle=…
  // or ?add=<what it calls for>. Consume the intent, then strip it so Back
  // doesn't reopen the sheet you just closed.
  const scanEnabled = auth.aiAvailable
  useEffect(() => {
    const wantAdd = params.get('add')
    const wantBottle = params.get('bottle')
    const wantScan = params.get('scan')
    if (!wantAdd && !wantBottle && !wantScan) return
    if (wantBottle && !loaded) return // the shelf hasn't arrived yet

    if (wantAdd) {
      setAddQuery(wantAdd === '1' ? '' : wantAdd)
      setAdding(true)
    }
    if (wantBottle) setViewing(items.find((i) => i.name === wantBottle) ?? null)
    if (wantScan) setScanIntent(true)
    setParams(new URLSearchParams(), { replace: true })
  }, [params, items, loaded, setParams])

  // Open the camera roll as soon as the intent and the sign-in line up — which
  // may be a beat later than the tap, since restoring a session boots Firebase.
  // The row below stays up either way, so a picker the browser declines to open
  // (or one the user cancels) still leaves something to tap.
  useEffect(() => {
    if (scanIntent && scanEnabled) fileRef.current?.click()
  }, [scanIntent, scanEnabled])

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

  const onScanFiles = async (files: FileList | null) => {
    if (!files || !files.length || !barId) return
    setScanIntent(false)
    setScanBusy(true)
    setScanError(null)
    try {
      const chosen = [...files].slice(0, MAX_SCAN_IMAGES)
      const images = await Promise.all(chosen.map((f) => downscaleDataUrl(f)))
      const { firebaseIdentifyBottles, firebaseReconcileBottles } = await import('../../import/firebaseAI')

      // Pass 1: what's on the shelf.
      const detected = await firebaseIdentifyBottles(images)

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
      const reconciled = await firebaseReconcileBottles(inputs)

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
      {/* No add buttons here: every way of putting something in the app is the
          + in the tab bar, which lands back on this screen with ?add or ?scan.
          Three competing adds on one screen was the reason it felt busy. */}
      <div className={styles.head}>
        <div className={styles.count}>
          {items.length} bottle{items.length === 1 ? '' : 's'} ·{' '}
          <Link className={styles.countLink} to="/browse?makeable=1">
            {makeableCount} drink{makeableCount === 1 ? '' : 's'} ready
          </Link>
        </div>
        <button className={styles.title} onClick={() => setManagingBars(true)}>
          {barName}
          <ChevronDownIcon size={20} className={styles.titleChevron} />
        </button>
      </div>

      {/* Only while a scan is actually in flight or waiting on a sign-in. */}
      {scanBusy && <p className={styles.scanBusy}>Reading your shelf…</p>}
      {scanIntent && !scanBusy && scanEnabled && (
        <button className={styles.scanAgain} onClick={() => fileRef.current?.click()}>
          <SparkleIcon size={15} /> Choose shelf photos
        </button>
      )}
      {scanIntent && !scanEnabled && auth.configured && (
        <button className={styles.signIn} onClick={() => void auth.signIn()}>
          <SparkleIcon size={15} /> Sign in with Google to scan your shelf
        </button>
      )}
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
            Tap ＋ to add the bottles you own — every recipe then knows what you can make.
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
        initialQuery={addQuery}
        onClose={() => {
          setAdding(false)
          setAddQuery('')
        }}
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
