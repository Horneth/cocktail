import { useEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { BottleArt } from '../../components/BottleArt'
import { BottleGlyph } from '../../components/BottleGlyph'
import { CheckIcon, SearchIcon, SparkleIcon } from '../../components/icons'
import type { PantryItem, Recipe } from '../../db/schema'
import { normIngredient } from '../../domain/availability'
import { oneAwaySuggestions, unlocksFor } from '../../domain/barInsights'
import { closeCandidates, resolveDetections, type ResolvedBottle } from '../../domain/bottleMatch'
import type { BottleInput } from '../../domain/pantry'
import { categoryForName } from '../../domain/spiritCategory'
import { BOTTLE_TYPES, bottleTypeLabel } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import { downscaleDataUrl } from '../../import/image'
import { MAX_SCAN_IMAGES } from '../../import/limits'
import type { IdentifiedBottle } from '../../import/aiShared'
import type { CatalogItem } from '../../hooks/useRecipes'
import { useAuth } from '../../hooks/useAuth'
import sheet from './sheet.module.css'
import styles from './AddBottleSheet.module.css'

export type ScanResult = ResolvedBottle<IdentifiedBottle>

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (bottles: BottleInput[]) => void
  /** every non-staple ingredient the library mentions */
  catalog: CatalogItem[]
  have: Set<string>
  items: PantryItem[]
  cocktails: Recipe[]
  byId: Map<string, Recipe>
  assumeStaples: boolean
  barName: string
  /** prefill, e.g. the ingredient a recipe sent you here to buy */
  initialQuery?: string
  presentation?: 'sheet' | 'screen'
}

interface Suggestion extends CatalogItem {
  /** how many drinks this single bottle would unlock right now */
  unlocks: number
}

// Enough to scroll through without turning the sheet into a directory.
const MAX_SUGGESTIONS = 40
// The key the category picker uses for the not-yet-added typed name.
const TYPED = '__typed__'

// Which scanned bottles start ticked. Only confidently-new ones: a bottle you
// already have, a near-variant, or one the model could barely read are all
// decisions worth a deliberate tap rather than an undo.
function defaultScanPicks(results: ScanResult[]): Set<string> {
  return new Set(
    results
      .filter((r) => r.verdict === 'new' && r.detected.confidence !== 'low')
      .map((r) => r.canonicalName),
  )
}

function toBottle(r: ScanResult): BottleInput {
  return {
    label: r.canonicalName,
    ...(r.detected.category ? { category: r.detected.category } : {}),
    ...(r.detected.brand ? { brand: r.detected.brand } : {}),
  }
}

/**
 * The one way bottles get in — the manual path and a photo scan side by side,
 * so AI is an accelerator, never the only way in. Typing/searching a bottle,
 * setting its type, and confirming all work signed out and offline. "Scan a
 * photo" (when AI is configured) adds a handful of recognition candidates to
 * the same review and confirm.
 */
export function AddBottleSheet({
  open,
  onClose,
  onAdd,
  catalog,
  have,
  items,
  cocktails,
  byId,
  assumeStaples,
  barName,
  initialQuery,
  presentation = 'sheet',
}: Props) {
  const auth = useAuth()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Map<string, BottleInput>>(new Map())
  const [typedCategory, setTypedCategory] = useState<string | null>(null)
  /** which row has its type picker open (TYPED for the one being typed) */
  const [picking, setPicking] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scan state. The file input lives here so picking photos is one gesture
  // between "scan" and the review — no separate sheet, no second navigation.
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null)
  const [scanPicked, setScanPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setQuery(initialQuery ?? '')
    setPicked(new Map())
    setTypedCategory(null)
    setPicking(null)
    setScanResults(null)
    setScanPicked(new Set())
    setScanError(null)
    inputRef.current?.focus({ preventScroll: true })
  }, [open, initialQuery])

  // Bottles the user doesn't have yet, best payoff first. The unlock counts come
  // from the same on-device engine the Bar screen uses — nothing is sent anywhere.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!open) return []
    const ranked = new Map(oneAwaySuggestions(cocktails, byId, have, assumeStaples, 8).map((s) => [s.name, s.unlocks]))
    return catalog
      .filter((c) => !have.has(c.name))
      .map((c) => ({ ...c, unlocks: ranked.get(c.name) ?? 0 }))
      .sort((a, b) => b.unlocks - a.unlocks || a.label.localeCompare(b.label))
  }, [open, catalog, have, cocktails, byId, assumeStaples])

  const q = query.trim()
  const shown = useMemo(() => {
    const list = q
      ? suggestions.filter((s) => s.label.toLowerCase().includes(q.toLowerCase()))
      : suggestions
    return list.slice(0, MAX_SUGGESTIONS)
  }, [suggestions, q])

  const typedKey = normIngredient(q)
  const showTyped =
    !!typedKey && !have.has(typedKey) && !suggestions.some((s) => s.name === typedKey) && !picked.has(typedKey)
  const typedGuess = typedCategory ?? (q ? categoryForName(q) : undefined)
  const typedVisual = spiritVisual(typedGuess ?? 'other')
  const typedUnlocks = useMemo(
    () => (showTyped ? unlocksFor([q], cocktails, byId, have, assumeStaples).unlocks : 0),
    [showTyped, q, cocktails, byId, have, assumeStaples],
  )

  const toggle = (name: string, bottle: BottleInput) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(name)) next.delete(name)
      else next.set(name, bottle)
      return next
    })

  const setCategory = (name: string, category: string) =>
    setPicked((prev) => {
      const bottle = prev.get(name)
      if (!bottle) return prev
      return new Map(prev).set(name, { ...bottle, category })
    })

  const addTyped = () => {
    if (!showTyped) return
    toggle(typedKey, { label: q, ...(typedGuess ? { category: typedGuess } : {}) })
    setQuery('')
    setTypedCategory(null)
    setPicking(null)
    inputRef.current?.focus()
  }

  // Picked bottles the library never mentioned would otherwise vanish the moment
  // the field clears — the count at the bottom being the only trace of them.
  const catalogKeys = useMemo(() => new Set(catalog.map((c) => c.name)), [catalog])
  const customPicks = [...picked.entries()].filter(([key]) => !catalogKeys.has(key))

  const scanChosen = useMemo(
    () => (scanResults ?? []).filter((r) => scanPicked.has(r.canonicalName)),
    [scanResults, scanPicked],
  )

  // Manual picks first, then scanned ones — deduped by their match key so a
  // bottle both typed and scanned is added once.
  const chosen = useMemo(() => {
    const seen = new Set<string>()
    const out: BottleInput[] = []
    for (const b of [...picked.values(), ...scanChosen.map(toBottle)]) {
      const key = normIngredient(b.label)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(b)
    }
    return out
  }, [picked, scanChosen])

  const total = useMemo(
    () => (chosen.length ? unlocksFor(chosen.map((b) => b.label), cocktails, byId, have, assumeStaples).unlocks : 0),
    [chosen, cocktails, byId, have, assumeStaples],
  )

  const onScanFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    setScanBusy(true)
    setScanError(null)
    try {
      const images = await Promise.all(
        [...files].slice(0, MAX_SCAN_IMAGES).map((f) => downscaleDataUrl(f)),
      )
      const { firebaseIdentifyBottles, firebaseReconcileBottles } = await import('../../import/firebaseAI')

      // Pass 1: what's on the shelf.
      const detected = await firebaseIdentifyBottles(images)

      // Between the passes, on-device: which of the user's own bottles is each
      // detection even worth comparing against. Only those few names travel —
      // never the inventory.
      const inputs = detected.map((d) => ({
        detected: d.name,
        ...(d.category ? { category: d.category } : {}),
        candidates: closeCandidates(d, items).map((c) => c.label),
      }))

      // Pass 2 is an enhancement, not a dependency — it resolves to [] rather
      // than throwing, and the local verdicts still drive a usable review.
      const reconciled = await firebaseReconcileBottles(inputs)
      const resolved = resolveDetections(detected, items, reconciled)

      setScanResults(resolved)
      setScanPicked(defaultScanPicks(resolved))
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Could not read those photos.')
    } finally {
      setScanBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleScan = (key: string) =>
    setScanPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const categoryChips = (selected: string | undefined, onPick: (key: string) => void) => (
    <div className={styles.chips}>
      {BOTTLE_TYPES.map((key) => {
        const v = spiritVisual(key)
        return (
          <button
            key={key}
            className={`${styles.chip} ${selected === key ? styles.chipOn : ''}`}
            onClick={() => onPick(key)}
          >
            <BottleGlyph shape={v.silhouette} size={13} color={v.dot} /> {bottleTypeLabel(key)}
          </button>
        )
      })}
    </div>
  )

  const found = scanResults?.length ?? 0

  return (
    <BottomSheet open={open} onClose={onClose} draggable={presentation === 'sheet'} presentation={presentation}>
      <div className={sheet.head}>
        <h2 className={sheet.title}>Add bottles</h2>
        <p className={sheet.subtitle}>to {barName}</p>
      </div>

      <div className={styles.search}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.searchInput}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setTypedCategory(null)
            setPicking(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && addTyped()}
          placeholder="Search or type a bottle…"
          aria-label="Search or type a bottle"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {auth.configured && (
          <button
            className={styles.scanBtn}
            onClick={() => auth.aiAvailable ? fileRef.current?.click() : void auth.signIn()}
            aria-label="Import"
          >
            <SparkleIcon size={17} />
            <span>Import</span>
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
      </div>

      {auth.configured && !auth.aiAvailable && auth.ready && (
        <button className={styles.signInRow} onClick={() => void auth.signIn()}>
          <SparkleIcon size={15} /> Sign in with Google to scan a photo
        </button>
      )}

      {showTyped && (
        <>
          <div className={`${styles.row} ${styles.rowTyped}`}>
            <span className={styles.glyph} style={{ background: typedVisual.tint }} aria-hidden>
              <BottleArt name={q} category={typedGuess ?? 'other'} size={20} />
            </span>
            <button className={styles.text} onClick={addTyped}>
              <span className={styles.label}>{q}</span>
              {typedUnlocks > 0 && (
                <span className={styles.unlock}>
                  unlocks {typedUnlocks} drink{typedUnlocks > 1 ? 's' : ''}
                </span>
              )}
            </button>
            <button
              className={styles.typeBtn}
              onClick={() => setPicking((v) => (v === TYPED ? null : TYPED))}
              aria-label="Change spirit category"
            >
              {typedGuess ? spiritVisual(typedGuess).label : 'Set type'}
            </button>
            <button className={styles.addBtn} onClick={addTyped} aria-label={`Add ${q}`}>
              Add
            </button>
          </div>
          {picking === TYPED && categoryChips(typedGuess, (key) => {
            setTypedCategory(key)
            setPicking(null)
          })}
        </>
      )}

      {customPicks.map(([key, bottle]) => {
        const v = spiritVisual(bottle.category ?? 'other')
        return (
          <div key={key}>
            <div className={`${styles.row} ${styles.rowOn}`}>
              <span className={styles.glyph} style={{ background: v.tint }} aria-hidden>
                <BottleArt name={bottle.label} category={bottle.category ?? 'other'} size={20} />
              </span>
            <span className={styles.text}>
              <span className={styles.label}>{bottle.label}</span>
            </span>
            <button
              className={styles.typeBtn}
              onClick={() => setPicking((v) => (v === key ? null : key))}
              aria-label={`Change spirit category for ${bottle.label}`}
            >
              {bottle.category ? spiritVisual(bottle.category).label : 'Set type'}
            </button>
            <button
              className={styles.remove}
              onClick={() => toggle(key, bottle)}
              aria-label={`Remove ${bottle.label}`}
            >
              ✕
            </button>
          </div>
          {picking === key && categoryChips(bottle.category, (cat) => {
            setCategory(key, cat)
            setPicking(null)
          })}
        </div>
      )
        })}

      <div className={sheet.body}>
        {shown.length === 0 && !showTyped ? (
          <p className={sheet.hint}>
            {q ? 'Already on the shelf.' : 'Every bottle your recipes call for is already on the shelf.'}
          </p>
        ) : (
          shown.map((s) => {
            const on = picked.has(s.name)
            const v = spiritVisual(categoryForName(s.label) ?? 'other')
            return (
              <button
                key={s.name}
                className={`${styles.row} ${on ? styles.rowOn : ''}`}
                onClick={() => toggle(s.name, { label: s.label })}
              >
                <span className={styles.glyph} style={{ background: v.tint }} aria-hidden>
                  <BottleArt name={s.label} category={categoryForName(s.label) ?? 'other'} size={20} />
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{s.label}</span>
                  {s.unlocks > 0 && <span className={styles.unlock}>unlocks {s.unlocks} drink{s.unlocks > 1 ? 's' : ''}</span>}
                </span>
                <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>
                  {on && <CheckIcon size={14} />}
                </span>
              </button>
            )
          })
        )}
      </div>

      {scanBusy && <p className={styles.scanStatus}>Reading your shelf…</p>}
      {scanError && <p className={styles.scanError}>{scanError}</p>}

      {scanResults && (
        <div className={styles.scanSection}>
          <p className={styles.scanHead}>
            {found ? `From your photo — ${found} bottle${found > 1 ? 's' : ''}` : 'Nothing read from that photo'}
          </p>
          {scanResults.map((r) => {
            const on = scanPicked.has(r.canonicalName)
            const already = r.verdict === 'same'
            const v = spiritVisual(r.detected.category ?? 'other')
            return (
              <button
                key={r.canonicalName}
                className={`${styles.row} ${on ? styles.rowOn : ''} ${already ? styles.rowMuted : ''}`}
                onClick={() => toggleScan(r.canonicalName)}
              >
                <span className={styles.glyph} style={{ background: v.tint }} aria-hidden>
                  <BottleArt name={r.canonicalName} category={r.detected.category ?? 'other'} size={20} />
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{r.canonicalName}</span>
                  {r.match && (
                    <span className={styles.unlock}>
                      {already ? 'already on your shelf as ' : 'looks like your '}
                      <b>{r.match}</b>
                    </span>
                  )}
                </span>
                <span
                  className={`${sheet.pill} ${
                    already
                      ? sheet.pillMuted
                      : r.verdict === 'variant' || r.detected.confidence === 'low'
                        ? sheet.pillWarn
                        : sheet.pillReady
                  }`}
                >
                  {already
                    ? 'In bar'
                    : r.verdict === 'variant'
                      ? 'Variant'
                      : r.detected.confidence === 'low'
                        ? 'Not sure'
                        : 'New'}
                </span>
                <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>
                  {on && <CheckIcon size={14} />}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className={sheet.actions}>
        <button className={sheet.ghost} onClick={onClose}>
          Cancel
        </button>
        <button className={sheet.solid} disabled={chosen.length === 0} onClick={() => onAdd(chosen)}>
          <span>
            Add {chosen.length || ''} bottle{chosen.length === 1 ? '' : 's'}
          </span>
          {total > 0 && (
            <span className={sheet.solidSub}>
              unlocks {total} drink{total > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>
    </BottomSheet>
  )
}